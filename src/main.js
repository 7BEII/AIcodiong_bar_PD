const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const STORE_FILE = "quota-state.json";
const LOG_FILE = "usage.log";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let mainWindow = null;

function createDefaultAccount(id, name) {
  const now = new Date().toISOString();

  return {
    id,
    name,
    weeklyLimit: 0,
    weeklyRemaining: 0,
    windowLimit: 0,
    windowRemaining: 0,
    windowHours: 5,
    weeklyStartedAt: now,
    weeklyResetAt: null,
    exhaustedAt: null,
    notes: "",
    history: []
  };
}

function createDefaultState() {
  return {
    accounts: [
      createDefaultAccount("account-1", "Codex 账号 1"),
      createDefaultAccount("account-2", "Codex 账号 2")
    ]
  };
}

function clampNumber(value, min = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, number);
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((entry) => entry && typeof entry === "object")
    .slice(0, 60);
}

function pushHistory(account, entry) {
  const historyEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry
  };

  account.history = [
    historyEntry,
    ...normalizeHistory(account.history)
  ].slice(0, 60);

  appendLog(account.name, historyEntry);
}

function appendLog(accountName, entry) {
  try {
    const logPath = path.join(app.getAppPath(), LOG_FILE);
    const timestamp = new Date().toLocaleString("zh-CN");
    const summary = entry.label || entry.type || "未知操作";

    let details = "";
    if (entry.type === "sync" || entry.type === "consume-window") {
      details = ` (变化: 周 ${entry.weeklyDelta}, 5H ${entry.windowDelta})`;
    }

    const logLine = `[${timestamp}] [${accountName}] ${summary}${details} | 周剩余: ${entry.weeklyRemaining}, 5H 剩余: ${entry.windowRemaining}\n`;
    fs.appendFileSync(logPath, logLine, "utf8");
  } catch (error) {
    console.error("Failed to append to log:", error);
  }
}

function applyWindowReset(account, reason) {
  account.windowRemaining = Math.min(account.windowLimit, account.weeklyRemaining);
  account.exhaustedAt = null;

  pushHistory(account, {
    type: "window-reset",
    label: reason,
    weeklyRemaining: account.weeklyRemaining,
    windowRemaining: account.windowRemaining
  });
}

function applyWeeklyReset(account, reason) {
  const now = new Date().toISOString();

  account.weeklyStartedAt = now;
  account.weeklyRemaining = account.weeklyLimit;
  account.windowRemaining = Math.min(account.windowLimit, account.weeklyRemaining);
  account.exhaustedAt = null;
  account.weeklyResetAt = null;

  pushHistory(account, {
    type: "weekly-reset",
    label: reason,
    weeklyRemaining: account.weeklyRemaining,
    windowRemaining: account.windowRemaining
  });
}

function refreshAccount(account, now = Date.now()) {
  const nextWeeklyResetAt = account.weeklyStartedAt
    ? new Date(account.weeklyStartedAt).getTime() + WEEK_MS
    : null;

  if (nextWeeklyResetAt && now >= nextWeeklyResetAt) {
    applyWeeklyReset(account, "周额度自动重置");
  } else if (account.weeklyResetAt && now >= new Date(account.weeklyResetAt).getTime()) {
    applyWeeklyReset(account, "周额度已达手动设置的恢复时间");
  }

  if (!account.exhaustedAt) {
    return account;
  }

  const resetAt = new Date(account.exhaustedAt).getTime() + account.windowHours * 60 * 60 * 1000;
  if (Number.isFinite(resetAt) && now >= resetAt) {
    applyWindowReset(account, "5 小时额度自动重置");
  }

  return account;
}

function normalizeAccount(rawAccount, fallbackAccount) {
  const account = {
    ...fallbackAccount,
    ...rawAccount
  };

  account.name = String(account.name || fallbackAccount.name);
  account.weeklyLimit = clampNumber(account.weeklyLimit);
  account.windowLimit = clampNumber(account.windowLimit);
  account.windowHours = clampNumber(account.windowHours, 1);
  account.weeklyRemaining = Math.min(clampNumber(account.weeklyRemaining), account.weeklyLimit);
  account.windowRemaining = Math.min(clampNumber(account.windowRemaining), account.windowLimit, account.weeklyRemaining);
  account.weeklyResetAt = account.weeklyResetAt || null;
  account.exhaustedAt = account.exhaustedAt || null;
  account.notes = String(account.notes || "");
  account.history = normalizeHistory(account.history);

  return refreshAccount(account);
}

function getStorePath() {
  return path.join(app.getPath("userData"), STORE_FILE);
}

function loadState() {
  const defaults = createDefaultState();
  const storePath = getStorePath();

  try {
    if (!fs.existsSync(storePath)) {
      return defaults;
    }

    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const accounts = defaults.accounts.map((fallbackAccount) => {
      const current = Array.isArray(raw.accounts)
        ? raw.accounts.find((item) => item && item.id === fallbackAccount.id)
        : null;

      return normalizeAccount(current, fallbackAccount);
    });

    return { accounts };
  } catch (_error) {
    return defaults;
  }
}

function saveState(state) {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(state, null, 2), "utf8");
}

function mutateState(mutator) {
  const state = loadState();
  const nextState = mutator(state) || state;
  saveState(nextState);
  return nextState;
}

function findAccount(state, accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  return account;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 400,
    minHeight: 640,
    autoHideMenuBar: true,
    title: "Quota Pulse",
    backgroundColor: "#111318",
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("state:get", async () => {
  const state = loadState();
  saveState(state);
  return state;
});

ipcMain.handle("account:save-config", async (_event, payload) => {
  return mutateState((state) => {
    const account = findAccount(state, payload.id);

    account.name = String(payload.name || account.name || "");
    account.weeklyLimit = clampNumber(payload.weeklyLimit);
    account.windowLimit = clampNumber(payload.windowLimit);
    account.windowHours = clampNumber(payload.windowHours, 1);

    if (!account.history.length && account.weeklyRemaining === 0 && account.windowRemaining === 0) {
      account.weeklyRemaining = account.weeklyLimit;
      account.windowRemaining = Math.min(account.windowLimit, account.weeklyRemaining);
      account.weeklyStartedAt = new Date().toISOString();
    } else {
      account.weeklyRemaining = Math.min(account.weeklyRemaining, account.weeklyLimit);
      account.windowRemaining = Math.min(account.windowRemaining, account.windowLimit, account.weeklyRemaining);
    }

    pushHistory(account, {
      type: "config",
      label: "更新额度配置",
      weeklyRemaining: account.weeklyRemaining,
      windowRemaining: account.windowRemaining
    });

    return state;
  });
});

ipcMain.handle("account:sync-remaining", async (_event, payload) => {
  return mutateState((state) => {
    const account = findAccount(state, payload.id);
    refreshAccount(account);

    const nextWeeklyRemaining = Math.min(clampNumber(payload.weeklyRemaining), account.weeklyLimit);
    const nextWindowRemaining = Math.min(
      clampNumber(payload.windowRemaining),
      account.windowLimit,
      nextWeeklyRemaining
    );

    const weeklyDelta = account.weeklyRemaining - nextWeeklyRemaining;
    const windowDelta = account.windowRemaining - nextWindowRemaining;

    account.weeklyRemaining = nextWeeklyRemaining;
    account.windowRemaining = nextWindowRemaining;

    if (payload.weeklyResetAt !== undefined) {
      account.weeklyResetAt = payload.weeklyResetAt ? new Date(payload.weeklyResetAt).toISOString() : null;
    }

    if (nextWindowRemaining === 0 && account.windowLimit > 0) {
      account.exhaustedAt = new Date().toISOString();
    } else if (nextWindowRemaining > 0) {
      account.exhaustedAt = null;
    }

    pushHistory(account, {
      type: "sync",
      label: payload.reason ? `手动同步: ${payload.reason}` : "手动同步剩余额度",
      weeklyDelta,
      windowDelta,
      weeklyRemaining: account.weeklyRemaining,
      windowRemaining: account.windowRemaining
    });

    return state;
  });
});

ipcMain.handle("account:consume-window", async (_event, payload) => {
  return mutateState((state) => {
    const account = findAccount(state, payload.id);
    refreshAccount(account);

    const consumed = account.windowRemaining;
    account.weeklyRemaining = Math.max(0, account.weeklyRemaining - consumed);
    account.windowRemaining = 0;
    account.exhaustedAt = new Date().toISOString();

    pushHistory(account, {
      type: "consume-window",
      label: "本轮 5 小时额度已用完",
      weeklyDelta: consumed,
      windowDelta: consumed,
      weeklyRemaining: account.weeklyRemaining,
      windowRemaining: account.windowRemaining
    });

    return state;
  });
});

ipcMain.handle("account:reset-window", async (_event, payload) => {
  return mutateState((state) => {
    const account = findAccount(state, payload.id);
    applyWindowReset(account, "手动重置 5 小时额度");
    return state;
  });
});

ipcMain.handle("account:reset-week", async (_event, payload) => {
  return mutateState((state) => {
    const account = findAccount(state, payload.id);
    applyWeeklyReset(account, "手动重置周额度");
    return state;
  });
});

app.whenReady().then(() => {
  saveState(loadState());
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
