'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  screen,
  shell,
  clipboard,
  dialog,
  globalShortcut,
  powerMonitor,
  desktopCapturer,
  nativeTheme,
  Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { loadSettings, saveSettings } = require('./src/settings');
const usageStore = require('./src/usage-store');
const todoStore = require('./src/todo-store');
const desktopPin = require('./src/desktop-pin');
const weather = require('./src/weather');
const msAuth = require('./src/ms-auth');
const msTodo = require('./src/ms-todo');
const todoSync = require('./src/todo-sync');

const APP_NAME = '桌面看板';
// 置顶层级（实测结论，2026-11-09）：
//   normal        —— 普通置顶，亚克力颜色最鲜活（默认）
//   screen-saver  —— 能盖住全屏播放器，但这一层会让亚克力明显发暗发灰，看起来像块黑玻璃
// 用菜单「外观 → 盖住全屏视频」或环境变量 BOARD_TOP_LEVEL 切换。
const TOP_LEVEL_OVERRIDE = process.env.BOARD_TOP_LEVEL || '';
const TICK_MS = 1000; // 界面每秒刷新
const IDLE_LIMIT_SECONDS = 180; // 3 分钟无键鼠输入 = 人不在，不计时
const SAVE_EVERY_MS = 20 * 1000; // 每 20 秒落盘一次

/** 毛玻璃实现方式，可用 --glass=acrylic|acrylic-t|mica|css 覆盖 */
const glassMode = (() => {
  const arg = process.argv.find((a) => a.startsWith('--glass='));
  const mode = arg ? arg.slice('--glass='.length).trim() : '';
  return ['acrylic', 'acrylic-t', 'mica', 'css'].includes(mode) ? mode : 'acrylic';
})();

/** 调试用：--capture=窗口截图路径 --deskshot=整屏截图路径（截图后自动退出） */
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const capturePath = argOf('capture');
const deskShotPath = argOf('deskshot');

let settings = loadSettings();
let usage = usageStore.load();
let todos = todoStore.load();
let lastDayKey = usageStore.dayKey(Date.now());

// 启动时先做一次跨天整理：昨天没勾的顺延到今天，昨天勾完的归档
if (todoStore.rollover(todos, lastDayKey)) todoStore.save(todos);

/** 每日目标时长，可在 data/settings.json 里改 goalHours */
const goalHours = Math.max(1, Math.min(24, Number(settings.goalHours) || 8));
const GOAL_SECONDS = Math.round(goalHours * 3600);

let win = null;
let tray = null;
let isQuitting = false; // 区分「用户关窗口（只是隐藏）」和「真的要退出」
let tickTimer = null;
let saveTimer = null;
let weatherTimer = null;
let glassTimer = null;
let saveBoundsTimer = null;
let dirty = false; // 有未落盘的秒数
let sessionLocked = false;
let lastTickAt = Date.now();
let lastShownMinute = -1; // 上次推给界面的是第几分钟，用来避免每秒重绘
let weatherState = weather.cached(); // 先用上次缓存，首屏不空
let weatherBusy = false;
let syncTimer = null;
let syncSoonTimer = null;
let lastSyncAt = 0;
let lastSyncError = '';
let lastSyncSummary = '';

/** 崩溃日志：写到 data/app.log，方便下次「打不开」时回头查原因（不弹窗、不打扰） */
function writeCrashLog(kind, detail) {
  try {
    const text =
      typeof detail === 'string' ? detail : (detail && (detail.stack || detail.message)) || JSON.stringify(detail);
    fs.appendFileSync(path.join(__dirname, 'data', 'app.log'), `[${new Date().toISOString()}] ${kind} ${text}\n`);
  } catch {
    /* 连日志都写不进去就算了，不能因为记日志再抛错 */
  }
}

process.on('uncaughtException', (err) => writeCrashLog('uncaughtException', err));
process.on('unhandledRejection', (err) => writeCrashLog('unhandledRejection', err));

const pad2 = (n) => String(n).padStart(2, '0');

function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// ---------------------------------------------------------------- 数据

/**
 * 首次运行时，用「本次开机时长」给今天一个初始估算，
 * 免得刚装上看到 0 分钟。之后每天从 0 开始按真实活跃时间累加。
 */
function seedToday() {
  const now = Date.now();
  const key = usageStore.dayKey(now);
  if (usage.days[key] != null) return;

  const sinceMidnight = (now - startOfDay(now)) / 1000;
  const estimate = Math.max(0, Math.min(os.uptime(), sinceMidnight));
  usage.days[key] = Math.round(estimate);
  usage.seeded[key] = true;
  dirty = true;
}

function addActiveSeconds(seconds) {
  const now = Date.now();
  const key = usageStore.dayKey(now);
  usage.days[key] = (usage.days[key] || 0) + seconds;
  dirty = true;
}

function persistUsage(force) {
  if (!dirty && !force) return;
  if (usageStore.save(usage)) dirty = false;
}

function buildBoard() {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const today = usageStore.dayKey(now);
  const uptimeSeconds = Math.floor(os.uptime());

  const days = [];
  let sum = 0;
  let activeDays = 0;

  for (let i = 6; i >= 0; i -= 1) {
    const dayStart = todayStart - i * 86400000;
    const key = usageStore.dayKey(dayStart);
    const seconds = Math.round(usage.days[key] || 0);
    const hasData = seconds > 60;
    days.push({
      key,
      date: dayStart,
      weekday: new Date(dayStart).getDay(),
      seconds,
      isToday: key === today,
      hasData,
      estimated: Boolean(usage.seeded[key]),
    });
    if (hasData) {
      sum += seconds;
      activeDays += 1;
    }
  }

  return {
    now,
    todaySeconds: Math.round(usage.days[today] || 0),
    uptimeSeconds,
    goalSeconds: GOAL_SECONDS,
    avg7Seconds: activeDays ? Math.round(sum / activeDays) : 0,
    idleLimitSeconds: IDLE_LIMIT_SECONDS,
    veil: settings.veil,
    pinned: Boolean(settings.pinToDesktop),
    weather: settings.weather.enabled
      ? weatherState || { ok: false, city: settings.weather.city }
      : null,
    todos: {
      items: todos.items,
      total: todos.items.length,
      done: todoStore.counts(todos).done,
    },
    msTodo: {
      enabled: Boolean(settings.msTodo.enabled && settings.msTodo.listId),
      listName: settings.msTodo.listName,
      lastAt: lastSyncAt,
      error: lastSyncError,
      syncing: todoSync.isSyncing(),
    },
    days,
  };
}

function broadcast() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('board:update', buildBoard());
}

/* ---------------- 微软待办：登录 / 选清单 / 同步 ---------------- */

function msOptions() {
  return {
    clientId: settings.msTodo.clientId,
    tenant: settings.msTodo.tenant,
    listId: settings.msTodo.listId,
    today: usageStore.dayKey(Date.now()),
  };
}

function msConfigured() {
  return Boolean(settings.msTodo.clientId);
}

function msSignedIn() {
  return Boolean(settings.msTodo.clientId && msAuth.hasToken());
}

function msStatusLine() {
  const { clientId, listId, listName } = settings.msTodo;
  if (!clientId) return '状态：还没配置 Client ID（看 docs/ms-todo-setup.md）';
  if (!msAuth.hasToken()) return '状态：已填 Client ID · 还没登录';
  if (!listId) return '状态：已登录 · 还没选清单';
  const when = lastSyncAt
    ? new Date(lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '还没同步';
  return `状态：${listName || '已选清单'} · ${lastSyncError ? `出错（${lastSyncError}）` : `上次 ${when}`}`;
}

async function syncNow(reason = 'auto') {
  if (!settings.msTodo.enabled || !settings.msTodo.listId) return;
  if (!msSignedIn() || todoSync.isSyncing()) return;

  broadcast(); // 让面板上的小云朵先变成「同步中」
  try {
    const res = await todoSync.sync(todos, msOptions());
    todoStore.save(todos);
    lastSyncAt = Date.now();
    lastSyncError = '';
    lastSyncSummary = `拉取 ${res.pulled} · 推送 ${res.pushed} · 更新 ${res.updated} · 删除 ${res.removed}`;
    if (reason === 'manual') showHint(`已同步：${lastSyncSummary}`);
  } catch (err) {
    lastSyncError = todoSync.describeError(err);
    console.warn('[ms-todo] 同步失败:', err.message);
    if (reason === 'manual') showHint(`同步失败：${lastSyncError}`);
  } finally {
    broadcast();
    refreshTrayMenu();
  }
}

/** 本地改了待办后，过 2 秒推一次远程（合并连点造成的多次写） */
function scheduleSyncSoon() {
  if (!settings.msTodo.enabled || !settings.msTodo.listId || !msSignedIn()) return;
  clearTimeout(syncSoonTimer);
  syncSoonTimer = setTimeout(() => syncNow('auto'), 2000);
}

function startSyncTimer() {
  clearInterval(syncTimer);
  syncTimer = null;
  if (!settings.msTodo.enabled || !settings.msTodo.listId || !msSignedIn()) return;
  const everyMs = Math.max(1, Number(settings.msTodo.syncMinutes) || 5) * 60 * 1000;
  syncTimer = setInterval(() => syncNow('auto'), everyMs);
}

async function msLogin() {
  const clientId = settings.msTodo.clientId;
  if (!clientId) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: '先注册一个 Azure 应用',
      message: '微软待办同步需要一个属于你自己的 Client ID（免费，而且只能用你自己的）',
      detail:
        '完整步骤见 docs/ms-todo-setup.md，大致是：\n' +
        '1. 打开 Azure 门户 → 应用注册 → 新注册\n' +
        '2. 账户类型选「任何组织目录中的账户 + 个人 Microsoft 账户」\n' +
        '3. 身份验证 → 允许公共客户端流 = 是\n' +
        '4. API 权限 → Microsoft Graph → 委托的权限 → 加 Tasks.ReadWrite 和 offline_access\n' +
        '5. 复制「应用程序(客户端) ID」，填进 data/settings.json 的 msTodo.clientId',
      buttons: ['打开 Azure 门户', '知道了'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      shell.openExternal('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade');
    }
    return;
  }

  try {
    const code = await msAuth.startDeviceCode(clientId, settings.msTodo.tenant);
    clipboard.writeText(code.userCode);
    shell.openExternal(code.verificationUri);
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: '登录微软待办',
      message: `浏览器里输入这个代码：${code.userCode}`,
      detail:
        `代码已经复制到剪贴板。\n在打开的页面里粘贴代码 → 用你的微软账号登录 → 同意授权。\n` +
        `完成后回到这里点「我已完成」（有效期约 ${Math.round(code.expiresIn / 60)} 分钟）。`,
      buttons: ['我已完成', '取消'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;

    await msAuth.pollDeviceCode(clientId, code.deviceCode, code.interval, settings.msTodo.tenant);
    notify('微软待办已登录', '接下来选一个要同步的清单');
    await msChooseList();
  } catch (err) {
    notify('登录失败', todoSync.describeError(err) || err.message || String(err));
  }
}

async function msChooseList() {
  if (!msSignedIn()) {
    showHint('先完成微软账号登录');
    return;
  }
  let lists = [];
  try {
    lists = await msTodo.listLists(settings.msTodo.clientId, settings.msTodo.tenant);
  } catch (err) {
    notify('读取清单失败', todoSync.describeError(err));
    return;
  }
  if (!lists.length) {
    showHint('这个账号里还没有待办清单');
    return;
  }
  const template = [
    { label: '选择要同步的清单', enabled: false },
    { type: 'separator' },
    ...lists.slice(0, 20).map((list) => ({
      label: `${list.name}${list.wellknown === 'defaultList' ? '（默认）' : ''}`,
      type: 'radio',
      checked: list.id === settings.msTodo.listId,
      click: () => {
        settings.msTodo.listId = list.id;
        settings.msTodo.listName = list.name;
        settings.msTodo.enabled = true;
        saveSettings(settings);
        refreshTrayMenu();
        broadcast();
        startSyncTimer();
        syncNow('manual');
      },
    })),
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
}

function msDisconnect() {
  msAuth.clearToken();
  settings.msTodo.enabled = false;
  lastSyncAt = 0;
  lastSyncError = '';
  saveSettings(settings);
  clearInterval(syncTimer);
  refreshTrayMenu();
  broadcast();
  showHint('已断开微软待办（本地待办还在）');
}


/** 拉天气：成功就更新并重绘；失败保留旧数据，不打扰用户 */
async function refreshWeather(force = false) {
  if (weatherBusy) return;
  if (!settings.weather.enabled && !force) return;
  weatherBusy = true;
  try {
    const next = await weather.fetchWeather(settings.weather.city, { force });
    weatherState = next;
    broadcast();
  } catch (err) {
    console.warn('[weather] 获取失败:', err.message);
    if (!weatherState) weatherState = { ok: false, city: settings.weather.city };
    broadcast();
  } finally {
    weatherBusy = false;
  }
}

/**
 * 每秒一拍：有人用就记 1 秒。
 *
 * 注意：界面显示的是「小时 + 分钟」，一分钟才变一次，所以这里**不必每秒都重绘**——
 * 只在「显示的分钟数」变化时才 broadcast。否则 Chromium 每秒重排一次带阴影的大字，
 * 会白白吃掉 5%~7% 的单核 CPU（实测 0.64s/10s）。
 */
function tick() {
  const now = Date.now();
  const delta = Math.min(5, Math.max(0, (now - lastTickAt) / 1000));
  lastTickAt = now;

  // 跨过零点：使用时长按新的一天重新累计，待办也顺手把没做完的顺延过来
  const todayKey = usageStore.dayKey(now);
  if (todayKey !== lastDayKey) {
    lastDayKey = todayKey;
    if (todoStore.rollover(todos, todayKey)) todoStore.save(todos);
  }

  if (!sessionLocked) {
    let idle = Number.POSITIVE_INFINITY;
    try {
      idle = powerMonitor.getSystemIdleTime();
    } catch {
      /* 某些系统读不到空闲时间，就当作在用 */
      idle = 0;
    }
    if (idle <= IDLE_LIMIT_SECONDS) addActiveSeconds(delta);
  }

  const shownMinute = Math.floor((usage.days[usageStore.dayKey(now)] || 0) / 60);
  if (shownMinute !== lastShownMinute) {
    lastShownMinute = shownMinute;
    broadcast();
  }
}

// ---------------------------------------------------------------- 窗口层级

/**
 * 三种层级：
 *  1. 固定到桌面 —— 不置顶，被点过之后重新压回 z 序最底层（不挡其它应用），并且锁定位置不能拖动
 *  2. 窗口置顶   —— 置顶层，默认 normal（毛玻璃颜色正常）；可选 screen-saver（盖住全屏视频但玻璃发暗）
 *  3. 普通窗口   —— 不置顶，正常叠放
 */
function applyWindowLevel() {
  if (!win || win.isDestroyed()) return;
  if (settings.pinToDesktop) {
    win.setAlwaysOnTop(false);
    setLocked(true);
    desktopPin.sendToBottom();
    setTimeout(refreshGlass, 150);
    dumpLevel('pin');
    return;
  }
  setLocked(false);
  win.setAlwaysOnTop(Boolean(settings.alwaysOnTop), topLevel());
  dumpLevel('topmost');
}

/** 调试用：--dump-level 时打印当前层级/锁定状态后退出 */
function dumpLevel(reason) {
  if (!process.argv.includes('--dump-level')) return;
  try {
    console.log(
      `[level:${reason}] pinned=${settings.pinToDesktop} top=${settings.alwaysOnTop} ` +
        `movable=${win.isMovable()} resizable=${win.isResizable()} onTop=${win.isAlwaysOnTop()}`
    );
  } catch (err) {
    console.log('[level] 读取失败:', err.message);
  }
}

/** 置顶层级：环境变量优先，其次读设置 */
function topLevel() {
  if (TOP_LEVEL_OVERRIDE) return TOP_LEVEL_OVERRIDE;
  return settings.topLevel === 'screen-saver' ? 'screen-saver' : 'normal';
}

/**
 * 固定到桌面时锁死窗口，避免被误拖动。
 * Windows 上 setMovable(false) 会让标题栏拖动失效，setResizable(false) 同时去掉边框拉伸。
 */
function setLocked(locked) {
  try {
    win.setMovable(!locked);
    win.setResizable(!locked);
  } catch {
    /* 个别平台不支持，忽略 */
  }
}

/**
 * 重新贴一次系统材质（亚克力/云母）。
 *
 * 为什么需要这个：Windows 在「透明效果」被临时关掉的时候（省电模式、全屏独占播放器、
 * 切换电源模式等都会触发）会把亚克力降级成实心色，而且**系统重新打开透明效果之后
 * 也不会自动给已经存在的窗口恢复**，看板就会一直是那块不透明的深灰。
 * 实测只要程序自己再调一次 setBackgroundMaterial(材质) 就能立刻恢复，
 * 所以这里定时 + 各种「窗口重新出现」的时机都补一刀。
 */
function refreshGlass() {
  if (!win || win.isDestroyed()) return;
  if (glassMode !== 'acrylic' && glassMode !== 'mica') return;
  try {
    win.setBackgroundMaterial(glassMode);
  } catch {
    /* 老系统不支持就算了 */
  }
}

/** 开启鼠标穿透时给个系统通知，避免用户以为程序失灵 */
function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  } catch {
    /* 通知失败不影响功能 */
  }
}

/** 在看板内部弹一条临时提示 */
function showHint(text) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('board:hint', text);
}

// ---------------------------------------------------------------- 窗口

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = settings.window.width || 380;
  const height = settings.window.height || 258;
  return {
    x: workArea.x + workArea.width - width - 28,
    y: workArea.y + 36,
    width,
    height,
  };
}

function isOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const overlapY = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return overlapX > 80 && overlapY > 60;
  });
}

function resolveBounds() {
  const fallback = defaultBounds();
  const saved = settings.window;
  const candidate = {
    x: typeof saved.x === 'number' ? saved.x : fallback.x,
    y: typeof saved.y === 'number' ? saved.y : fallback.y,
    width: saved.width || fallback.width,
    height: saved.height || fallback.height,
  };
  return isOnSomeDisplay(candidate) ? candidate : fallback;
}

function createWindow() {
  const bounds = resolveBounds();

  const options = {
    ...bounds,
    minWidth: 320,
    minHeight: 200,
    frame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    show: false,
    title: APP_NAME,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  };

  if (glassMode === 'acrylic' || glassMode === 'mica') {
    // Windows 11 系统级亚克力/云母：真·毛玻璃，由 DWM 实时模糊桌面
    options.transparent = false;
    options.backgroundMaterial = glassMode;
  } else {
    options.transparent = true;
  }

  win = new BrowserWindow(options);

  desktopPin.setTarget(win.getNativeWindowHandle());
  applyWindowLevel();
  if (settings.clickThrough) win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    // --todo-demo 只在截图/录演示时用：启动后直接展开待办面板
    query: { glass: glassMode, todo: process.argv.includes('--todo-demo') ? '1' : '0' },
  });

  // 「固定到桌面」模式：点过一次（获得焦点）就重新压回最底层，
  // 这样它永远待在桌面层，不会长期盖在别的应用上面。
  win.on('blur', () => {
    if (settings.pinToDesktop) {
      setTimeout(() => {
        desktopPin.sendToBottom();
        refreshGlass();
      }, 80);
    }
  });

  win.once('ready-to-show', () => {
    win.showInactive();
    refreshGlass();
    broadcast();
    if (settings.pinToDesktop) setTimeout(() => desktopPin.sendToBottom(), 300);

    if (capturePath || deskShotPath) {
      setTimeout(() => writeDebugShots(), 1500);
    }
  });

  // 窗口重新露面/被点到/从最小化恢复时，顺便重新贴一次材质
  win.on('show', refreshGlass);
  win.on('focus', refreshGlass);
  win.on('restore', refreshGlass);

  win.webContents.on('did-finish-load', () => {
    broadcast();
  });

  win.on('moved', persistBoundsSoon);
  win.on('resized', persistBoundsSoon);

  // Alt+F4 / 任务栏关闭 => 只是隐藏，不要真的销毁窗口。
  // 以前这里直接让窗口被销毁，而进程还在托盘里活着，于是：
  // 再双击启动器 → 撞上单实例锁 → 第二个实例直接退出 → 什么都不出现（看起来像坏了）。
  win.on('close', (event) => {
    persistUsage(false);
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/**
 * 窗口不存在（被销毁 / 渲染进程崩了）时重建一个。
 * 托盘点击、Ctrl+Alt+H、以及「用户又双击了一次启动器」都会走这里，
 * 保证任何时候点一下都能把看板叫回来。
 */
function ensureWindow() {
  if (win && !win.isDestroyed()) return false;
  createWindow();
  return true;
}

/** 调试截图：窗口自身渲染 + 整屏（等价肉眼所见），完成后退出 */
async function writeDebugShots() {
  try {
    if (capturePath) {
      const img = await win.capturePage();
      fs.writeFileSync(path.resolve(capturePath), img.toPNG());
      console.log('[debug] window ->', capturePath, JSON.stringify(img.getSize()));
    }
    if (deskShotPath) {
      const display = screen.getPrimaryDisplay();
      const dpr = display.scaleFactor || 1;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(display.size.width * dpr),
          height: Math.round(display.size.height * dpr),
        },
      });
      const src = sources[0];
      if (src) {
        fs.writeFileSync(path.resolve(deskShotPath), src.thumbnail.toPNG());
        console.log('[debug] desktop ->', deskShotPath, JSON.stringify(src.thumbnail.getSize()));
      }
    }
  } catch (err) {
    console.warn('[debug] 截图失败:', err.message);
  } finally {
    app.quit();
  }
}

function persistBoundsSoon() {
  if (!win || win.isDestroyed()) return;
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const [width, height] = win.getSize();
    settings.window = { x, y, width, height };
    saveSettings(settings);
  }, 400);
}

// ---------------------------------------------------------------- 开机自启

function startupShortcutPath() {
  return path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    `${APP_NAME}.lnk`
  );
}

function isAutoStartEnabled() {
  return fs.existsSync(startupShortcutPath());
}

function setAutoStart(enabled) {
  const link = startupShortcutPath();
  try {
    if (enabled) {
      shell.writeShortcutLink(link, 'create', {
        target: process.execPath,
        args: `"${app.getAppPath()}"`,
        cwd: app.getAppPath(),
        description: `${APP_NAME} - 桌面使用时长`,
        icon: process.execPath,
        iconIndex: 0,
      });
    } else {
      fs.rmSync(link, { force: true });
    }
  } catch (err) {
    console.warn('[autostart] 设置失败:', err.message);
  }
}

// ---------------------------------------------------------------- 菜单

const VEIL_LABELS = [
  ['normal', '标准'],
  ['clear', '更透明'],
  ['ultra', '最透明'],
];

function toggleClickThrough(next) {
  settings.clickThrough = typeof next === 'boolean' ? next : !settings.clickThrough;
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  }
  refreshTrayMenu();

  if (settings.clickThrough) {
    notify('鼠标穿透已开启', '看板不再接收鼠标点击。按 Ctrl + Alt + D 关闭，或右键托盘图标操作。');
    showHint('鼠标穿透已开启 · Ctrl+Alt+D 关闭');
  }
}

/** 固定到桌面：始终在屏幕上，但不压在其它应用上面 */
function togglePinToDesktop(next) {
  settings.pinToDesktop = typeof next === 'boolean' ? next : !settings.pinToDesktop;
  if (settings.pinToDesktop) settings.alwaysOnTop = false;
  applyWindowLevel();
  saveSettings(settings);
  refreshTrayMenu();
  broadcast();
  showHint(
    settings.pinToDesktop
      ? '已固定到桌面 · 位置已锁定（再点一次图钉解锁）'
      : '已取消固定 · 可以拖动和缩放了'
  );
}

function setVeil(veil) {
  settings.veil = veil;
  saveSettings(settings);
  broadcast();
}

function setTheme(theme) {
  settings.theme = theme;
  nativeTheme.themeSource = theme;
  saveSettings(settings);
  broadcast();
}

/** 切换置顶层级：normal = 普通置顶（毛玻璃颜色正常），screen-saver = 盖住全屏视频但玻璃发暗 */
function setTopLevel(level) {
  settings.topLevel = level === 'screen-saver' ? 'screen-saver' : 'normal';
  applyWindowLevel();
  refreshGlass();
  saveSettings(settings);
  refreshTrayMenu();
  showHint(
    settings.topLevel === 'screen-saver'
      ? '已改为盖住全屏视频 · 毛玻璃会略暗'
      : '已改为普通置顶 · 毛玻璃颜色正常'
  );
}

function toggleVisible(force) {
  ensureWindow();
  if (!win || win.isDestroyed()) return;
  const visible = win.isVisible() && !win.isMinimized();
  const next = typeof force === 'boolean' ? force : !visible;
  if (next) {
    win.showInactive();
    applyWindowLevel();
  } else {
    win.hide();
  }
}

/** 菜单模板：窗口菜单和托盘菜单共用，避免两处各写一份还写不一致 */
function menuTemplate() {
  const items = [
    {
      label: '固定到桌面（不挡住应用）',
      type: 'checkbox',
      checked: Boolean(settings.pinToDesktop),
      click: (item) => togglePinToDesktop(item.checked),
    },
    {
      label: '窗口置顶（盖住其它窗口）',
      type: 'checkbox',
      checked: Boolean(settings.alwaysOnTop) && !settings.pinToDesktop,
      enabled: !settings.pinToDesktop,
      click: (item) => {
        settings.alwaysOnTop = item.checked;
        settings.pinToDesktop = false;
        applyWindowLevel();
        saveSettings(settings);
        refreshTrayMenu();
      },
    },
    {
      label: settings.clickThrough ? '鼠标穿透（已开启 · Ctrl+Alt+D 关闭）' : '鼠标穿透',
      type: 'checkbox',
      checked: Boolean(settings.clickThrough),
      click: (item) => toggleClickThrough(item.checked),
    },
    { type: 'separator' },
    {
      label: '外观',
      submenu: [
        { label: '跟随系统', type: 'radio', checked: settings.theme === 'system', click: () => setTheme('system') },
        { label: '浅色玻璃', type: 'radio', checked: settings.theme === 'light', click: () => setTheme('light') },
        { label: '深色玻璃（更透）', type: 'radio', checked: settings.theme === 'dark', click: () => setTheme('dark') },
        { type: 'separator' },
        {
          label: '盖住全屏视频（毛玻璃会略暗）',
          type: 'checkbox',
          checked: settings.topLevel === 'screen-saver',
          enabled: !TOP_LEVEL_OVERRIDE,
          click: (item) => setTopLevel(item.checked ? 'screen-saver' : 'normal'),
        },
        {
          label: '修复毛玻璃（变实心时点一下）',
          click: () => {
            refreshGlass();
            showHint('毛玻璃已重新贴上');
          },
        },
      ],
    },
    {
      label: '透明度',
      submenu: VEIL_LABELS.map(([value, label]) => ({
        label,
        type: 'radio',
        checked: settings.veil === value,
        click: () => setVeil(value),
      })),
    },
    {
      label: '天气',
      submenu: [
        {
          label: '显示天气',
          type: 'checkbox',
          checked: Boolean(settings.weather.enabled),
          click: (item) => {
            settings.weather.enabled = item.checked;
            saveSettings(settings);
            refreshTrayMenu();
            if (item.checked) refreshWeather(false);
            else broadcast();
          },
        },
        {
          label: `刷新天气（${settings.weather.city}）`,
          click: () => refreshWeather(true),
        },
      ],
    },
    {
      label: '刷新数据',
      click: () => {
        persistUsage(false);
        broadcast();
      },
    },
    {
      label: '今日待办',
      submenu: [
        {
          label: `清空已完成（${todoStore.counts(todos).done} 项）`,
          enabled: todoStore.counts(todos).done > 0,
          click: () => {
            const doomed = todos.items.filter((it) => it.done && it.remoteId);
            const n = todoStore.clearDone(todos);
            if (n > 0) {
              todoStore.save(todos);
              broadcast();
              showHint(`已清空 ${n} 项已完成的待办`);
              // 远程也要删，不然下次同步会把它们当「新任务」再拉回来
              if (doomed.length && settings.msTodo.enabled && msSignedIn()) {
                Promise.all(doomed.map((it) => todoSync.removeRemote(msOptions(), it.remoteId)))
                  .then(() => syncNow('auto'))
                  .catch(() => {});
              }
            }
          },
        },
        { type: 'separator' },
        {
          label: '说明：没勾的会顺延到第二天',
          enabled: false,
        },
      ],
    },
    // 只有配置过 Client ID（或已经登录过）才显示这一组，否则普通用户的托盘菜单保持干净
    ...(settings.msTodo.clientId || msAuth.hasToken()
      ? [
          {
            label: '微软待办同步',
            submenu: [
              { label: msStatusLine(), enabled: false },
              { type: 'separator' },
              {
                label: msSignedIn() ? '重新登录微软账号…' : '登录微软账号…',
                click: () => msLogin(),
              },
              {
                label: '选择要同步的清单…',
                enabled: msSignedIn(),
                click: () => msChooseList(),
              },
              {
                label: '立即同步',
                enabled: Boolean(settings.msTodo.enabled && settings.msTodo.listId && msSignedIn()),
                click: () => syncNow('manual'),
              },
              { type: 'separator' },
              {
                label: '断开连接（删除本地保存的登录令牌）',
                enabled: msAuth.hasToken(),
                click: () => msDisconnect(),
              },
              {
                label: '配置说明见 docs/ms-todo-setup.md',
                enabled: false,
              },
            ],
          },
        ]
      : []),
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: isAutoStartEnabled(),
      click: (item) => setAutoStart(item.checked),
    },
    { type: 'separator' },
    {
      label: '隐藏看板',
      accelerator: 'Ctrl+Alt+H',
      click: () => toggleVisible(false),
    },
    {
      label: '退出',
      accelerator: 'Ctrl+Alt+Q',
      click: () => app.quit(),
    },
  ];

  return items;
}

function popupMenu() {
  if (!win || win.isDestroyed()) return;
  Menu.buildFromTemplate(menuTemplate()).popup({ window: win });
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const template = menuTemplate();
  // 托盘菜单第一项换成「显示 / 隐藏看板」，其余和窗口菜单一致
  template.unshift({ label: '显示 / 隐藏看板', click: () => toggleVisible() }, { type: 'separator' });
  tray.setContextMenu(Menu.buildFromTemplate(template));
  const state = [];
  if (settings.pinToDesktop) state.push('固定桌面');
  else if (settings.alwaysOnTop) state.push('置顶');
  if (settings.clickThrough) state.push('穿透');
  tray.setToolTip(state.length ? `${APP_NAME}（${state.join(' · ')}）` : APP_NAME);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();

  tray = new Tray(icon);
  refreshTrayMenu();
  tray.on('click', () => toggleVisible());
}

// ---------------------------------------------------------------- 生命周期

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 用户又双击了一次启动器：窗口没了就重建，有就把它叫到前面
    ensureWindow();
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) win.showInactive();
      applyWindowLevel();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.yiquanzhi.usage-board');

    // 玻璃配色：命令行 --theme 优先，其次用户设置；默认跟随 Windows 系统主题
    const themeArg = argOf('theme');
    nativeTheme.themeSource =
      themeArg === 'dark' || themeArg === 'light' ? themeArg : settings.theme;

    seedToday();
    createWindow();
    createTray();

    tickTimer = setInterval(tick, TICK_MS);
    saveTimer = setInterval(() => persistUsage(false), SAVE_EVERY_MS);

    // 亚克力自愈：系统临时关掉「透明效果」再打开后，窗口不会自己恢复，
    // 每 10 秒重新贴一次材质（材质没变时是空操作，不会闪）。
    glassTimer = setInterval(refreshGlass, 10 * 1000);

    // 天气：启动时拉一次，之后每 10 分钟一次（接口本身有缓存窗口）
    if (settings.weather.enabled) refreshWeather(false);
    weatherTimer = setInterval(() => refreshWeather(false), weather.FRESH_MS);

    // 微软待办：启动后补一次同步，之后按设置里的间隔轮询
    if (settings.msTodo.enabled && settings.msTodo.listId && msSignedIn()) {
      setTimeout(() => syncNow('auto'), 1500);
      startSyncTimer();
    }

    powerMonitor.on('lock-screen', () => {
      sessionLocked = true;
      persistUsage(false);
    });
    powerMonitor.on('unlock-screen', () => {
      sessionLocked = false;
      lastTickAt = Date.now();
      refreshGlass();
      syncNow('auto'); // 锁屏期间可能在外面用手机改了待办
    });
    powerMonitor.on('suspend', () => persistUsage(false));
    powerMonitor.on('resume', () => {
      lastTickAt = Date.now();
      refreshWeather(false); // 睡眠期间可能已经换天了
      refreshGlass();
      syncNow('auto');
    });
    screen.on('display-metrics-changed', refreshGlass);

    // 渲染进程崩了（极少见）：记一笔，然后自动重载页面，别留个空壳在托盘里
    app.on('render-process-gone', (_event, _contents, details) => {
      writeCrashLog('render-process-gone', details && details.reason ? details.reason : 'unknown');
      if (!isQuitting && win && !win.isDestroyed()) {
        setTimeout(() => {
          try {
            win.reload();
          } catch (err) {
            writeCrashLog('reload-failed', err);
          }
        }, 800);
      }
    });

    globalShortcut.register('Control+Alt+H', () => toggleVisible());
    globalShortcut.register('Control+Alt+D', () => toggleClickThrough());
    globalShortcut.register('Control+Alt+Q', () => app.quit());
  });

  // 关闭窗口不退出：看板常驻托盘，退出请用托盘/右键菜单
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    isQuitting = true; // 之后的 close 事件放行，真的销毁窗口
    persistUsage(false);
  });

  app.on('will-quit', () => {
    clearInterval(tickTimer);
    clearInterval(saveTimer);
    clearInterval(glassTimer);
    clearInterval(syncTimer);
    clearTimeout(syncSoonTimer);
    persistUsage(true);
    todoStore.save(todos);
    desktopPin.stop();
    globalShortcut.unregisterAll();
  });
}

// ---------------------------------------------------------------- IPC

ipcMain.handle('board:snapshot', () => buildBoard());
ipcMain.on('ui:context-menu', () => popupMenu());
ipcMain.on('ui:toggle-pin', () => togglePinToDesktop());
ipcMain.on('ui:quit', () => app.quit());
ipcMain.on('ui:hide', () => toggleVisible(false));
ipcMain.on('ui:refresh', () => {
  persistUsage(false);
  broadcast();
});

/* ---------------- 今日待办 ---------------- */

function persistTodos() {
  // 每次改动立刻落盘：待办是「人手动敲的东西」，丢了比多写几次盘更难受
  todoStore.save(todos);
  broadcast();
  scheduleSyncSoon();
}

ipcMain.on('todos:add', (_event, text) => {
  const item = todoStore.add(todos, text, usageStore.dayKey(Date.now()));
  if (item) persistTodos();
});

ipcMain.on('todos:toggle', (_event, id) => {
  if (!id) return;
  if (todoStore.toggle(todos, id, usageStore.dayKey(Date.now()))) persistTodos();
});

ipcMain.on('todos:remove', (_event, id) => {
  if (!id) return;
  const item = todos.items.find((it) => it.id === id);
  const remoteId = item && item.remoteId;
  if (!todoStore.remove(todos, id)) return;
  persistTodos();
  // 远程那边也删掉，否则下次同步会把它又拉回来
  if (remoteId && settings.msTodo.enabled && msSignedIn()) {
    todoSync
      .removeRemote(msOptions(), remoteId)
      .then((ok) => {
        if (ok) syncNow('auto');
      })
      .catch(() => {});
  }
});
