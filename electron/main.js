const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { verifyLicenseKey } = require("./license");

const ICON_PATH = path.join(__dirname, "..", "build", "icon.png");
const WINDOW_ICON = fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;
const LICENSE_PUBLIC_KEY_PATH = path.join(__dirname, "..", "assets", "license-public.pem");
const IS_MAC = process.platform === "darwin";
const IS_WINDOWS = process.platform === "win32";

let mainWindow = null;
let timer = null;

function getLicenseStatePath() {
  return path.join(app.getPath("userData"), "license.json");
}

/** Lowercase process name fragments; first match marks app running */
const WATCHED_APPS = [
  { id: "slack", label: "Slack", patterns: ["slack"] },
  {
    id: "teams",
    label: "Microsoft Teams",
    patterns: ["ms-teams", "msteams", "teams"],
  },
  { id: "gather", label: "Gather", patterns: ["gather"] },
  { id: "discord", label: "Discord", patterns: ["discord"] },
  { id: "zoom", label: "Zoom", patterns: ["zoom"] },
  { id: "webex", label: "Webex", patterns: ["webex", "ciscocollabhost", "ciscoteams"] },
  { id: "skype", label: "Skype", patterns: ["skype", "lync"] },
  { id: "signal", label: "Signal", patterns: ["signal"] },
  { id: "element", label: "Element", patterns: ["element"] },
  { id: "mattermost", label: "Mattermost", patterns: ["mattermost"] },
];

function readLicensePublicKey() {
  try {
    return fs.readFileSync(LICENSE_PUBLIC_KEY_PATH, "utf8");
  } catch {
    return null;
  }
}

function readStoredLicenseKey() {
  try {
    const raw = fs.readFileSync(getLicenseStatePath(), "utf8");
    return JSON.parse(raw)?.licenseKey || "";
  } catch {
    return "";
  }
}

function writeStoredLicenseKey(licenseKey) {
  const statePath = getLicenseStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify({ licenseKey, updatedAt: Date.now() }, null, 2),
    "utf8"
  );
}

function clearStoredLicenseKey() {
  try {
    fs.unlinkSync(getLicenseStatePath());
  } catch {
    /* ignore */
  }
}

function serializeLicenseStatus(result) {
  if (!result) {
    return {
      state: "inactive",
      valid: false,
      message: "Activate a license key to unlock ActiveDesk.",
      planId: null,
      planLabel: null,
      email: "",
      expiresAt: null,
      issuedAt: null,
    };
  }

  return {
    state: result.valid ? "active" : result.status,
    valid: Boolean(result.valid),
    message: result.message,
    planId: result.plan?.id || result.payload?.plan || null,
    planLabel: result.plan?.label || null,
    email: result.payload?.email || "",
    expiresAt: result.payload?.expiresAt || null,
    issuedAt: result.payload?.issuedAt || null,
  };
}

function readLicenseState() {
  try {
    const raw = fs.readFileSync(getLicenseStatePath(), "utf8");
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function writeLicenseState(state) {
  const statePath = getLicenseStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function getTrialStatus() {
  const state = readLicenseState();
  if (!state.trialStartedAt) {
    return null;
  }

  const startTime = Number(state.trialStartedAt);
  const now = Date.now();
  const hoursElapsed = (now - startTime) / (1000 * 60 * 60);
  const hoursRemaining = Math.max(0, 168 - hoursElapsed);

  return {
    isActive: hoursRemaining > 0,
    hoursRemaining,
  };
}

function initializeTrial() {
  const state = readLicenseState();
  if (!state.trialStartedAt) {
    state.trialStartedAt = Date.now();
    writeLicenseState(state);
  }
}

function getLicenseStatus() {
  const publicKeyPem = readLicensePublicKey();
  if (!publicKeyPem) {
    return {
      state: "unconfigured",
      valid: false,
      message: "Licensing is not configured yet. Run npm run license:init before packaging releases.",
      planId: null,
      planLabel: null,
      email: "",
      expiresAt: null,
      issuedAt: null,
    };
  }

  const storedKey = readStoredLicenseKey();
  if (!storedKey) {
    // No key: check trial status
    const trial = getTrialStatus();
    if (!trial) {
      // First run: initialize trial
      initializeTrial();
      return {
        state: "trial",
        valid: true,
        message: "Trial active for 24 hours. Get a license to continue after trial expires.",
        planId: null,
        planLabel: "Trial",
        email: "",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        issuedAt: Date.now(),
      };
    }

    if (trial.isActive) {
      const hoursStr = trial.hoursRemaining.toFixed(1);
      return {
        state: "trial",
        valid: true,
        message: `Trial active. ${hoursStr} hours remaining. Get a license to continue.`,
        planId: null,
        planLabel: "Trial",
        email: "",
        expiresAt: Date.now() + trial.hoursRemaining * 60 * 60 * 1000,
        issuedAt: Date.now(),
      };
    } else {
      return {
        state: "trial_expired",
        valid: false,
        message: "Trial expired. Purchase a license to continue using ActiveDesk.",
        planId: null,
        planLabel: null,
        email: "",
        expiresAt: null,
        issuedAt: null,
      };
    }
  }

  return serializeLicenseStatus(verifyLicenseKey(storedKey, publicKeyPem));
}

function activateLicenseKey(licenseKey) {
  const publicKeyPem = readLicensePublicKey();
  if (!publicKeyPem) {
    return getLicenseStatus();
  }

  const result = verifyLicenseKey(licenseKey, publicKeyPem);
  if (!result.valid) {
    return serializeLicenseStatus(result);
  }

  writeStoredLicenseKey(String(licenseKey).trim());
  return getLicenseStatus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 440,
    minHeight: 520,
    resizable: true,
    show: false,
    title: "ActiveDesk",
    icon: WINDOW_ICON,
    autoHideMenuBar: true,
    backgroundColor: "#0c0c0e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );

    let stderr = "";
    let stdout = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `PowerShell exited with code ${code}`));
    });
  });
}

function runOsascript(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", args);

    let stderr = "";
    let stdout = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `osascript exited with code ${code}`));
    });
  });
}

function createUnsupportedPlatformError() {
  return new Error(`ActiveDesk does not support ${process.platform} yet.`);
}

function normalizeAutomationError(err) {
  const message = err?.message || "Automation failed.";
  if (IS_MAC && /not allowed to send keystrokes/i.test(message)) {
    return new Error(
      "ActiveDesk needs Accessibility permission on macOS before it can send key presses. Enable it in System Settings > Privacy & Security > Accessibility."
    );
  }
  return err instanceof Error ? err : new Error(message);
}

async function getRunningProcessNamesLower() {
  if (IS_MAC) {
    const out = await runOsascript([
      "-e",
      'tell application "System Events" to get name of every process whose background only is false',
    ]);
    const names = out
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return new Set(names);
  }

  if (!IS_WINDOWS) {
    throw createUnsupportedPlatformError();
  }

  const script = `
$proc = Get-Process -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty ProcessName |
  ForEach-Object { $_.ToLowerInvariant() } |
  Sort-Object -Unique
$proc -join [char]10
`;
  const out = await runPowerShell(script);
  const names = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(names);
}

function scanCollaborationApps() {
  return getRunningProcessNamesLower().then((names) => {
    return WATCHED_APPS.map((appDef) => {
      const running = appDef.patterns.some((p) => {
        for (const n of names) {
          if (n === p || n.includes(p)) return true;
        }
        return false;
      });
      return { id: appDef.id, label: appDef.label, running };
    });
  });
}

function simulateActivity(includeShift) {
  if (IS_MAC) {
    const moveMouseScript = [
      'ObjC.import("Cocoa");',
      'ObjC.import("ApplicationServices");',
      "const point = $.NSEvent.mouseLocation;",
      "const x = Number(point.x);",
      "const y = Number(point.y);",
      "$.CGWarpMouseCursorPosition($.CGPointMake(x + 1, y));",
      "$.CGWarpMouseCursorPosition($.CGPointMake(x, y));",
    ].join(" ");

    const tasks = [runOsascript(["-l", "JavaScript", "-e", moveMouseScript])];
    if (includeShift) {
      tasks.push(runOsascript(["-e", 'tell application "System Events" to key code 56']));
    }
    return Promise.all(tasks).catch((err) => {
      throw normalizeAutomationError(err);
    });
  }

  if (!IS_WINDOWS) {
    return Promise.reject(createUnsupportedPlatformError());
  }

  const moveMouseScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Native {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
$dx = Get-Random -Minimum -30 -Maximum 31
$dy = Get-Random -Minimum -30 -Maximum 31
[Native]::mouse_event(0x0001, $dx, $dy, 0, [UIntPtr]::Zero)
`;

  const shiftScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Native {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
[Native]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Native]::keybd_event(0x10, 0, 0x0002, [UIntPtr]::Zero)
`;

  const tasks = [runPowerShell(moveMouseScript)];
  if (includeShift) tasks.push(runPowerShell(shiftScript));
  return Promise.all(tasks);
}

function scheduleActivityLoop(intervalSeconds, shiftEnabled) {
  if (timer) clearInterval(timer);
  const interval = Math.max(5, Number(intervalSeconds) || 60) * 1000;

  const tick = async () => {
    try {
      await simulateActivity(shiftEnabled);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("activedesk:tick", {
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("activedesk:error", {
          message: err.message || "Activity simulation failed.",
        });
      }
    }
  };

  timer = setInterval(tick, interval);
  void tick();
}

ipcMain.handle("activedesk:getApps", async () => {
  const apps = await scanCollaborationApps();
  return { apps };
});

ipcMain.handle("activedesk:start", (_event, { intervalSeconds, includeShift }) => {
  const licenseStatus = getLicenseStatus();
  if (!licenseStatus.valid) {
    throw new Error(licenseStatus.message || "Activate a valid license before starting ActiveDesk.");
  }

  const shiftEnabled = Boolean(includeShift);
  scheduleActivityLoop(intervalSeconds, shiftEnabled);
  return { ok: true, intervalSeconds: Math.max(5, Number(intervalSeconds) || 60) };
});

ipcMain.handle("activedesk:stop", () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  return { ok: true };
});

ipcMain.handle("activedesk:setAlwaysOnTop", (_event, flag) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(Boolean(flag));
  }
  return { ok: true };
});

ipcMain.handle("activedesk:getLaunchAtLogin", () => {
  try {
    return { openAtLogin: app.getLoginItemSettings().openAtLogin };
  } catch {
    return { openAtLogin: false };
  }
});

ipcMain.handle("activedesk:setLaunchAtLogin", (_event, openAtLogin) => {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(openAtLogin) });
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle("activedesk:openExternal", async (_event, url) => {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) {
    return { ok: false };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle("activedesk:getLicenseStatus", () => {
  return getLicenseStatus();
});

ipcMain.handle("activedesk:activateLicense", (_event, licenseKey) => {
  return activateLicenseKey(licenseKey);
});

ipcMain.handle("activedesk:clearLicense", () => {
  clearStoredLicenseKey();
  return getLicenseStatus();
});

app.whenReady().then(() => {
  createWindow();

  try {
    globalShortcut.register("CommandOrControl+Shift+A", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("activedesk:hotkey-toggle");
      }
    });
  } catch {
    /* ignore */
  }
});

app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
});

app.on("window-all-closed", () => {
  if (timer) clearInterval(timer);
  if (process.platform !== "darwin") app.quit();
});
