const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ICON_PATH = path.join(__dirname, "..", "build", "icon.png");
const WINDOW_ICON = fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;

let mainWindow = null;
let timer = null;

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

async function getRunningProcessNamesLower() {
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
