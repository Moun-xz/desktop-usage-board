'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  window: { width: 380, height: 258, x: null, y: null },
  alwaysOnTop: true,
  pinToDesktop: false, // 固定到桌面层：始终在屏幕上，但不压在其它应用上面
  clickThrough: false, // 只在运行时有效，不写入磁盘（防止重启后被锁死点不到）
  veil: 'clear', // 玻璃透明度：normal | clear | ultra
  theme: 'system', // 玻璃配色：system | light | dark（dark = 深色玻璃，透光感更强）
  topLevel: 'normal', // 置顶层级：normal（毛玻璃颜色正常）| screen-saver（盖住全屏视频，但玻璃会发暗）
  goalHours: 8, // 每日目标时长（小时），改 data/settings.json 即可调整
  weather: { enabled: true, city: '北京' }, // 卡片右上角天气；改成你所在的城市名即可
  // 微软待办（Microsoft To Do）双向同步。clientId 需要你在 Azure 里注册一个应用拿到，
  // 详见 docs/ms-todo-setup.md；不填就纯本地用，不影响其它功能。
  msTodo: {
    enabled: false,
    clientId: '',
    tenant: 'consumers', // 个人微软账号用 consumers；公司/学校账号用 common
    listId: '',
    listName: '',
    syncMinutes: 5, // 后台每隔几分钟拉一次
  },
};

const VEILS = ['normal', 'clear', 'ultra'];
const THEMES = ['system', 'light', 'dark'];
const TOP_LEVELS = ['normal', 'screen-saver'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 读取设置，文件损坏或缺失时回退到默认值 */
function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const merged = {
      ...DEFAULTS,
      ...raw,
      window: { ...DEFAULTS.window, ...(raw && raw.window ? raw.window : {}) },
      weather: { ...DEFAULTS.weather, ...(raw && raw.weather ? raw.weather : {}) },
      msTodo: { ...DEFAULTS.msTodo, ...(raw && raw.msTodo ? raw.msTodo : {}) },
    };
    if (!VEILS.includes(merged.veil)) merged.veil = DEFAULTS.veil;
    if (!THEMES.includes(merged.theme)) merged.theme = DEFAULTS.theme;
    if (!TOP_LEVELS.includes(merged.topLevel)) merged.topLevel = DEFAULTS.topLevel;
    if (typeof merged.weather.city !== 'string' || !merged.weather.city.trim()) {
      merged.weather.city = DEFAULTS.weather.city;
    }
    merged.msTodo.clientId = String(merged.msTodo.clientId || '').trim();
    merged.msTodo.listId = String(merged.msTodo.listId || '').trim();
    merged.msTodo.listName = String(merged.msTodo.listName || '').trim();
    if (!['consumers', 'common', 'organizations'].includes(merged.msTodo.tenant)) {
      merged.msTodo.tenant = DEFAULTS.msTodo.tenant;
    }
    merged.msTodo.syncMinutes = Math.min(60, Math.max(1, Number(merged.msTodo.syncMinutes) || 5));
    merged.clickThrough = false;
    return merged;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function saveSettings(settings) {
  try {
    ensureDir(DATA_DIR);
    // clickThrough 故意不落盘：否则下次启动看板不可点击，只能靠托盘/快捷键救回来
    const { clickThrough, ...persisted } = settings;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(persisted, null, 2), 'utf8');
  } catch (err) {
    console.warn('[settings] 保存失败:', err.message);
  }
}

module.exports = { DATA_DIR, SETTINGS_FILE, DEFAULTS, VEILS, THEMES, TOP_LEVELS, loadSettings, saveSettings };
