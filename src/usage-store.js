'use strict';

/* ------------------------------------------------------------------
   使用时长本地存储
   记录「活跃使用秒数」：只有在本机有键鼠输入（或最近 3 分钟内有输入）
   时才累加，因此睡眠 / 挂机 / 锁屏不计入。数据落在 data/usage.json。

   为什么不用系统开机时长：现代待机（S0ix）下 Windows 不会写睡眠日志，
   os.uptime() 会把合盖整晚也算成"开机中"，一天能算满 24 小时，
   对"我今天用了多久电脑"毫无参考价值，故改为自行采样统计。
------------------------------------------------------------------ */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'usage.json');
const KEEP_DAYS = 120; // 只保留最近 120 天，文件一直很小

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地自然日键：2026-11-09 */
function dayKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function emptyStore() {
  return { version: 1, days: {}, seeded: {} };
}

/** 读取，任何异常都回退到空数据，绝不因为坏文件起不来 */
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const days = {};
    for (const [key, value] of Object.entries(raw.days || {})) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) days[key] = seconds;
    }
    const seeded = raw.seeded && typeof raw.seeded === 'object' ? raw.seeded : {};
    return { version: 1, days, seeded };
  } catch {
    return emptyStore();
  }
}

/** 原子写入：先写 .tmp 再改名，避免断电留下半截 JSON */
function save(store) {
  try {
    const keys = Object.keys(store.days).sort();
    for (const key of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) {
      delete store.days[key];
      delete store.seeded[key];
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = { version: 1, days: {}, seeded: store.seeded || {} };
    for (const [key, value] of Object.entries(store.days)) {
      payload.days[key] = Math.round(value);
    }
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, FILE);
    return true;
  } catch (err) {
    console.warn('[usage] 保存失败:', err.message);
    return false;
  }
}

module.exports = { dayKey, load, save, DATA_DIR, FILE };
