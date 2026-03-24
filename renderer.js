(function bootstrap() {
  if (typeof window.activeDesk === "undefined") {
    const shell = document.querySelector(".shell");
    if (shell) {
      shell.innerHTML = `
      <section class="panel wrong-launch">
        <h1 class="wrong-title">Use the ActiveDesk program, not this HTML file</h1>
        <p class="wrong-text">
          The list of apps (Microsoft Teams, Slack, and others) comes from Windows
          process names. A browser cannot access that, so nothing will show as running here.
        </p>
        <p class="wrong-text"><strong>Run the real app:</strong></p>
        <ul class="wrong-list">
          <li>Open a terminal in this folder and run <code class="wrong-code">npm start</code></li>
          <li>Or run your built <code class="wrong-code">ActiveDesk.exe</code> / installer from <code class="wrong-code">dist-electron</code></li>
        </ul>
        <p class="wrong-note">
          Double-clicking <code class="wrong-code">index.html</code> only opens Chrome or Edge.
          Teams can be open on your PC and this page will still not detect it.
        </p>
      </section>`;
    }
    return;
  }

const statusEl = document.getElementById("status");
const detailEl = document.getElementById("detail");
const intervalEl = document.getElementById("interval");
const shiftEl = document.getElementById("shift");
const toggleBtn = document.getElementById("toggleBtn");
const appGridEl = document.getElementById("appGrid");
const appsSummaryEl = document.getElementById("appsSummary");
const engineScanEl = document.getElementById("engineScan");
const statusLedEl = document.getElementById("statusLed");
const tickCountEl = document.getElementById("tickCount");
const countdownEl = document.getElementById("countdown");
const sessionTimeEl = document.getElementById("sessionTime");
const refreshAppsBtn = document.getElementById("refreshApps");
const alwaysOnTopEl = document.getElementById("alwaysOnTop");
const launchAtLoginEl = document.getElementById("launchAtLogin");
const presetButtons = document.querySelectorAll(".preset");

let isRunning = false;
let appsPoll = null;
let countdownTimer = null;
let sessionTimer = null;
let sessionStartedAt = null;
let currentIntervalSec = 60;
let nextPulseAt = 0;
let tickCount = 0;

let scanErrorClearId = null;

function showScanError(message) {
  if (scanErrorClearId) clearTimeout(scanErrorClearId);
  engineScanEl.removeAttribute("hidden");
  engineScanEl.textContent = message;
  scanErrorClearId = setTimeout(() => {
    engineScanEl.textContent = "";
    engineScanEl.setAttribute("hidden", "");
    scanErrorClearId = null;
  }, 5000);
}

function setBodyRunning(running) {
  document.body.classList.toggle("is-running", running);
}

function formatSession(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function updateCountdownDisplay() {
  if (!isRunning) {
    countdownEl.textContent = "--";
    countdownEl.classList.add("muted-dash");
    return;
  }
  const left = Math.max(0, Math.ceil((nextPulseAt - Date.now()) / 1000));
  countdownEl.textContent = `${left}s`;
  countdownEl.classList.remove("muted-dash");
}

function startCountdownLoop() {
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdownDisplay();
  countdownTimer = setInterval(updateCountdownDisplay, 400);
}

function stopCountdownLoop() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  countdownEl.textContent = "--";
  countdownEl.classList.add("muted-dash");
}

function startSessionTimer() {
  sessionStartedAt = Date.now();
  if (sessionTimer) clearInterval(sessionTimer);
  sessionTimeEl.textContent = "0:00";
  sessionTimer = setInterval(() => {
    if (!sessionStartedAt) return;
    sessionTimeEl.textContent = formatSession(Date.now() - sessionStartedAt);
  }, 500);
}

function stopSessionTimer() {
  if (sessionTimer) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }
  sessionStartedAt = null;
  sessionTimeEl.textContent = "0:00";
}

function updatePresetSelection() {
  const v = Number(intervalEl.value);
  presetButtons.forEach((btn) => {
    const s = Number(btn.dataset.seconds);
    btn.classList.toggle("is-selected", s === v);
  });
}

function setUiState(running) {
  isRunning = running;
  setBodyRunning(running);
  statusLedEl.classList.toggle("is-on", running);

  if (running) {
    statusEl.textContent = "Running";
    statusEl.classList.remove("stopped");
    statusEl.classList.add("running");
    detailEl.textContent = "Pulses run on your interval. You can minimize this window.";
    toggleBtn.textContent = "Stop";
    toggleBtn.classList.remove("primary");
    toggleBtn.classList.add("danger");
    nextPulseAt = Date.now() + currentIntervalSec * 1000;
    startCountdownLoop();
    startSessionTimer();
  } else {
    statusEl.textContent = "Stopped";
    statusEl.classList.remove("running");
    statusEl.classList.add("stopped");
    detailEl.textContent = "Start to simulate small mouse moves on your chosen interval.";
    toggleBtn.textContent = "Start";
    toggleBtn.classList.remove("danger");
    toggleBtn.classList.add("primary");
    stopCountdownLoop();
    stopSessionTimer();
    tickCount = 0;
    tickCountEl.textContent = "0";
  }
}

function renderAppGrid(apps) {
  const running = apps.filter((a) => a.running);
  const runningCount = running.length;
  appsSummaryEl.textContent =
    runningCount === 0 ? "None right now" : `${runningCount} app${runningCount === 1 ? "" : "s"}`;

  appGridEl.innerHTML = "";
  if (runningCount === 0) {
    const empty = document.createElement("p");
    empty.className = "app-grid-empty";
    empty.textContent =
      "No tracked collaboration apps are running. Open Teams, Slack, or similar, then refresh.";
    appGridEl.appendChild(empty);
    return;
  }

  running.forEach((appItem, i) => {
    const row = document.createElement("div");
    row.className = "app-row is-live";
    row.setAttribute("role", "listitem");
    row.style.animationDelay = `${i * 0.02}s`;

    const name = document.createElement("span");
    name.className = "app-name";
    name.textContent = appItem.label;
    name.title = appItem.label;

    const badge = document.createElement("span");
    badge.className = "app-badge on";
    badge.textContent = "Running";

    row.appendChild(name);
    row.appendChild(badge);
    appGridEl.appendChild(row);
  });
}

/**
 * @param {{ silent?: boolean; manual?: boolean }} [options]
 *   silent: no status text (background poll). manual: brief button label feedback.
 */
async function refreshApps(options = {}) {
  const silent = options.silent !== false;
  const manual = Boolean(options.manual);

  if (!window.activeDesk?.getApps) return;

  if (manual) {
    refreshAppsBtn.disabled = true;
  }

  try {
    const { apps } = await window.activeDesk.getApps();
    renderAppGrid(apps);
    if (manual) {
      const prev = refreshAppsBtn.textContent;
      refreshAppsBtn.textContent = "List updated";
      setTimeout(() => {
        refreshAppsBtn.textContent = prev;
      }, 1400);
    }
  } catch {
    showScanError("Could not refresh app list.");
  } finally {
    if (manual) {
      refreshAppsBtn.disabled = false;
    }
  }
}

async function start() {
  const intervalSeconds = Number(intervalEl.value);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5) {
    detailEl.textContent = "Use at least 5 seconds.";
    return;
  }

  const res = await window.activeDesk.start({
    intervalSeconds,
    includeShift: shiftEl.checked,
  });
  currentIntervalSec = res?.intervalSeconds ?? intervalSeconds;
  tickCount = 0;
  tickCountEl.textContent = "0";
  setUiState(true);
}

async function stop() {
  await window.activeDesk.stop();
  setUiState(false);
}

async function toggleRun() {
  try {
    if (isRunning) await stop();
    else await start();
  } catch (err) {
    detailEl.textContent = err.message || "Action failed.";
  }
}

toggleBtn.addEventListener("click", toggleRun);

refreshAppsBtn.addEventListener("click", () => refreshApps({ silent: true, manual: true }));

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    intervalEl.value = btn.dataset.seconds;
    updatePresetSelection();
  });
});

intervalEl.addEventListener("input", updatePresetSelection);

alwaysOnTopEl.addEventListener("change", async () => {
  try {
    await window.activeDesk.setAlwaysOnTop(alwaysOnTopEl.checked);
  } catch {
    /* ignore */
  }
});

launchAtLoginEl.addEventListener("change", async () => {
  try {
    await window.activeDesk.setLaunchAtLogin(launchAtLoginEl.checked);
  } catch {
    /* ignore */
  }
});

window.activeDesk.onTick(() => {
  if (!isRunning) return;
  tickCount += 1;
  tickCountEl.textContent = String(tickCount);
  nextPulseAt = Date.now() + currentIntervalSec * 1000;
  const now = new Date();
  detailEl.textContent = `Last pulse ${now.toLocaleTimeString()}`;
});

window.activeDesk.onError((payload) => {
  detailEl.textContent = payload?.message || "Simulation error.";
});

window.activeDesk.onHotkeyToggle(() => {
  void toggleRun();
});

/* PayFast support — same flow as your extension (USD → ZAR, receiver, return/cancel/notify URLs). */
const EXCHANGE_RATE_CACHE_KEY = "activedesk_usd_to_zar_rate";
const EXCHANGE_RATE_CACHE_DURATION = 60 * 60 * 1000;
const EXCHANGE_RATE_APIS = [
  { name: "exchangerate-api.com", url: "https://api.exchangerate-api.com/v4/latest/USD", extractRate: (data) => data?.rates?.ZAR || null },
  { name: "open.er-api.com", url: "https://open.er-api.com/v6/latest/USD", extractRate: (data) => data?.rates?.ZAR || null },
];

async function fetchRateFromAPI(api) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(api.url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    const data = await response.json();
    return api.extractRate(data);
  } catch {
    return null;
  }
}

async function getUSDToZARRate() {
  const cached = localStorage.getItem(EXCHANGE_RATE_CACHE_KEY);
  if (cached) {
    try {
      const cache = JSON.parse(cached);
      if (Date.now() - cache.timestamp < EXCHANGE_RATE_CACHE_DURATION) return cache.rate;
    } catch {
      /* ignore */
    }
  }
  for (const api of EXCHANGE_RATE_APIS) {
    const rate = await fetchRateFromAPI(api);
    if (rate) {
      localStorage.setItem(EXCHANGE_RATE_CACHE_KEY, JSON.stringify({ rate, timestamp: Date.now() }));
      return rate;
    }
  }
  try {
    const fallback = JSON.parse(localStorage.getItem(EXCHANGE_RATE_CACHE_KEY) || "{}");
    if (fallback.rate) return fallback.rate;
  } catch {
    /* ignore */
  }
  return 18.5;
}

async function openPayFastSupport() {
  const btn = document.getElementById("payfastBtn");
  if (!btn || !window.activeDesk?.openExternal) return;
  const originalText = btn.textContent;
  btn.textContent = "Processing...";
  btn.disabled = true;
  try {
    const rate = await getUSDToZARRate();
    const usdAmount = 1.0;
    const zarAmount = usdAmount * rate;
    const params = new URLSearchParams({
      cmd: "_paynow",
      receiver: "23594634",
      return_url: "https://www.trevnoctilla.com/payment/return",
      cancel_url: "https://www.trevnoctilla.com/payment/cancel",
      notify_url: "https://www.trevnoctilla.com/payment/notify",
      amount: zarAmount.toFixed(2),
      item_name: "Buy Me a Coffee Support",
    });
    const payUrl = `https://payment.payfast.io/eng/process?${params.toString()}`;
    await window.activeDesk.openExternal(payUrl);
  } catch (e) {
    console.error("PayFast open failed:", e);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

const payfastBtn = document.getElementById("payfastBtn");
if (payfastBtn) {
  payfastBtn.addEventListener("click", () => void openPayFastSupport());
}

(async function init() {
  try {
    const { openAtLogin } = await window.activeDesk.getLaunchAtLogin();
    launchAtLoginEl.checked = Boolean(openAtLogin);
  } catch {
    launchAtLoginEl.checked = false;
  }
  updatePresetSelection();
})();

setUiState(false);
refreshApps({ silent: true });
appsPoll = setInterval(() => refreshApps({ silent: true }), 30000);
})();
