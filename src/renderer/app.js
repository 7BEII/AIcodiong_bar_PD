const state = {
  data: null,
  activeAccountId: "account-1"
};

const tabsElement = document.getElementById("tabs");
const panelsElement = document.getElementById("panels");
const panelTemplate = document.getElementById("panel-template");

function percent(used, limit) {
  if (!limit) {
    return 0;
  }

  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) {
    return "未开始";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "00:00:00";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

function nextWindowResetLabel(account) {
  if (!account.windowLimit) {
    return "等待配置";
  }

  if (!account.exhaustedAt) {
    return "待机中";
  }

  const resetAt = new Date(account.exhaustedAt).getTime() + account.windowHours * 60 * 60 * 1000;
  const left = resetAt - Date.now();
  return left > 0 ? formatDuration(left) : "即将重置";
}

function nextWeeklyResetLabel(account) {
  if (account.weeklyResetAt) {
    return `下次 ${formatDateTime(account.weeklyResetAt)}`;
  }

  if (!account.weeklyStartedAt || !account.weeklyLimit) {
    return "周重置未开始";
  }

  const resetAt = new Date(account.weeklyStartedAt).getTime() + 7 * 24 * 60 * 60 * 1000;
  return `下次 ${formatDateTime(resetAt)}`;
}

function historyText(entry) {
  const weeklyDelta = Number(entry.weeklyDelta || 0);
  const windowDelta = Number(entry.windowDelta || 0);
  const weeklyRemaining = formatNumber(entry.weeklyRemaining || 0);
  const windowRemaining = formatNumber(entry.windowRemaining || 0);

  if (entry.type === "config") {
    return `周剩余 ${weeklyRemaining}，5 小时剩余 ${windowRemaining}`;
  }

  if (entry.type === "weekly-reset" || entry.type === "window-reset") {
    return `重置后：周剩余 ${weeklyRemaining}，5 小时剩余 ${windowRemaining}`;
  }

  return `周变化 ${weeklyDelta > 0 ? "-" : "+"}${formatNumber(Math.abs(weeklyDelta))}，5 小时变化 ${windowDelta > 0 ? "-" : "+"}${formatNumber(Math.abs(windowDelta))}。当前周剩余 ${weeklyRemaining}，5 小时剩余 ${windowRemaining}`;
}

function renderTabs() {
  tabsElement.innerHTML = "";

  state.data.accounts.forEach((account, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab-button ${account.id === state.activeAccountId ? "active" : ""}`;
    button.dataset.accountId = account.id;
    button.innerHTML = `
      <span class="tab-kicker">Account ${index + 1}</span>
      <span class="tab-title">${account.name}</span>
    `;
    button.addEventListener("click", () => {
      state.activeAccountId = account.id;
      syncActiveView();
    });
    tabsElement.appendChild(button);
  });
}

function createPanel(account) {
  const fragment = panelTemplate.content.cloneNode(true);
  const panel = fragment.querySelector(".panel");
  panel.dataset.accountId = account.id;
  panel.id = account.id;

  const configForm = fragment.querySelector(".config-form");
  configForm.elements.name.value = account.name;
  configForm.elements.weeklyLimit.value = account.weeklyLimit || "";
  configForm.elements.windowLimit.value = account.windowLimit || "";
  configForm.elements.windowHours.value = account.windowHours || 5;

  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await window.quotaApi.saveConfig({
      id: account.id,
      name: configForm.elements.name.value.trim(),
      weeklyLimit: configForm.elements.weeklyLimit.value,
      windowLimit: configForm.elements.windowLimit.value,
      windowHours: configForm.elements.windowHours.value
    });
    await refreshState(true);
  });

  const syncForm = fragment.querySelector(".sync-form");
  syncForm.elements.weeklyRemaining.placeholder = String(account.weeklyRemaining || 0);
  syncForm.elements.windowRemaining.placeholder = String(account.windowRemaining || 0);

  syncForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await window.quotaApi.syncRemaining({
      id: account.id,
      weeklyRemaining: syncForm.elements.weeklyRemaining.value || account.weeklyRemaining,
      windowRemaining: syncForm.elements.windowRemaining.value || account.windowRemaining,
      weeklyResetAt: syncForm.elements.weeklyResetAt.value,
      reason: syncForm.elements.reason.value.trim()
    });
    syncForm.reset();
    await refreshState(true);
  });

  fragment.querySelector(".action-consume").addEventListener("click", async () => {
    await window.quotaApi.consumeWindow(account.id);
    await refreshState(true);
  });

  fragment.querySelector(".action-reset-window").addEventListener("click", async () => {
    await window.quotaApi.resetWindow(account.id);
    await refreshState(true);
  });

  fragment.querySelector(".action-reset-week").addEventListener("click", async () => {
    await window.quotaApi.resetWeek(account.id);
    await refreshState(true);
  });

  return fragment;
}

function renderPanels() {
  panelsElement.innerHTML = "";
  state.data.accounts.forEach((account) => {
    panelsElement.appendChild(createPanel(account));
  });
  state.data.accounts.forEach(updatePanel);
  syncActiveView();
}

function updatePanel(account) {
  const panel = document.getElementById(account.id);
  if (!panel) {
    return;
  }

  const weeklyUsed = Math.max(0, account.weeklyLimit - account.weeklyRemaining);
  const windowUsed = Math.max(0, account.windowLimit - account.windowRemaining);
  const weeklyBar = percent(weeklyUsed, account.weeklyLimit);
  const windowBar = percent(windowUsed, account.windowLimit);

  panel.querySelector(".panel-name").textContent = account.name;
  panel.querySelector(".countdown-value").textContent = nextWindowResetLabel(account);
  panel.querySelector(".weekly-used").textContent = `${formatNumber(weeklyUsed)} / ${formatNumber(account.weeklyLimit)}`;
  panel.querySelector(".weekly-remaining").textContent = `剩余 ${formatNumber(account.weeklyRemaining)}`;
  panel.querySelector(".weekly-reset").textContent = nextWeeklyResetLabel(account);
  panel.querySelector(".window-used").textContent = `${formatNumber(windowUsed)} / ${formatNumber(account.windowLimit)}`;
  panel.querySelector(".window-remaining").textContent = `剩余 ${formatNumber(account.windowRemaining)}`;
  panel.querySelector(".window-status").textContent = account.exhaustedAt
    ? `重置时间 ${formatDateTime(new Date(account.exhaustedAt).getTime() + account.windowHours * 60 * 60 * 1000)}`
    : "待机中";
  panel.querySelector(".weekly-bar").style.width = `${weeklyBar}%`;
  panel.querySelector(".window-bar").style.width = `${windowBar}%`;

  const syncForm = panel.querySelector(".sync-form");
  if (document.activeElement !== syncForm.elements.weeklyRemaining) {
    syncForm.elements.weeklyRemaining.placeholder = String(account.weeklyRemaining || 0);
  }
  if (document.activeElement !== syncForm.elements.windowRemaining) {
    syncForm.elements.windowRemaining.placeholder = String(account.windowRemaining || 0);
  }

  if (account.weeklyResetAt && document.activeElement !== syncForm.elements.weeklyResetAt) {
    const date = new Date(account.weeklyResetAt);
    const tzoffset = date.getTimezoneOffset() * 60000;
    const localISOTime = new Date(date.getTime() - tzoffset).toISOString().slice(0, 16);
    syncForm.elements.weeklyResetAt.value = localISOTime;
  }

  const historyElement = panel.querySelector(".history");
  if (!account.history.length) {
    historyElement.innerHTML = `<p class="history-empty">还没有记录。保存配置或同步一次剩余额度后，这里会开始显示。</p>`;
    return;
  }

  historyElement.innerHTML = account.history
    .slice(0, 8)
    .map((entry) => {
      return `
        <article class="history-item">
          <header>
            <strong>${entry.label || "记录"}</strong>
            <time>${formatDateTime(entry.createdAt)}</time>
          </header>
          <p>${historyText(entry)}</p>
        </article>
      `;
    })
    .join("");
}

function syncActiveView() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.accountId === state.activeAccountId);
  });

  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.accountId === state.activeAccountId);
  });
}

async function refreshState(fullRender = false) {
  state.data = await window.quotaApi.getState();

  if (fullRender || !document.querySelector(".panel")) {
    renderTabs();
    renderPanels();
    return;
  }

  renderTabs();
  state.data.accounts.forEach(updatePanel);
  syncActiveView();
}

async function init() {
  await refreshState(true);
  setInterval(() => {
    refreshState(false);
  }, 1000);
}

init();
