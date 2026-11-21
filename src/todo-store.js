'use strict';

/* ------------------------------------------------------------------
   今日待办 · 本地存储

   规则（2026-11-21 和用户确认过）：
   - 只关心「今天」：昨天没勾的，第二天自动顺延到今天；
   - 昨天已经勾掉的，第二天自动归档（不再显示，也不占列表）；
   - 数据落在 data/todos.json，和 usage.json 一样是「先写 .tmp 再改名」，
     断电最多丢最后一次改动，不会留下半截 JSON。

   这一层只做数据，不碰窗口和界面；主进程负责什么时候加载 / 什么时候落盘。
------------------------------------------------------------------- */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'todos.json');
const VERSION = 2;
const MAX_ITEMS = 40; // 一个小组件，40 条已经比窗口高了，再多也看不过来
const MAX_TEXT = 80; // 单条文字上限，超了直接截断（避免把窗口撑爆）

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地自然日键：2026-11-21 */
function dayKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function emptyStore() {
  return { version: VERSION, items: [] };
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 单个条目的清洗：坏字段一律丢掉，不要让一条脏数据拖垮整个列表 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return null;
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    text: text.slice(0, MAX_TEXT),
    done: Boolean(raw.done),
    day: typeof raw.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : dayKey(Date.now()),
    createdAt,
    doneAt: typeof raw.doneAt === 'string' ? raw.doneAt : null,
    updatedAt: Number(raw.updatedAt) || Date.parse(createdAt) || Date.now(),
    // 微软待办（Microsoft To Do）相关：remoteId 为空 = 还没同步过
    remoteId: typeof raw.remoteId === 'string' && raw.remoteId ? raw.remoteId : null,
    remoteAt: Number(raw.remoteAt) || 0,
  };
}

/** 读取；任何异常都回退到空列表，绝不因为坏文件让看板起不来 */
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!raw || !Array.isArray(raw.items)) return emptyStore();
    const items = raw.items.map(normalize).filter(Boolean).slice(0, MAX_ITEMS);
    return { version: VERSION, items };
  } catch {
    return emptyStore();
  }
}

/** 原子写入：先写 .tmp 再改名 */
function save(store) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = { version: VERSION, items: store.items.slice(0, MAX_ITEMS) };
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
    return true;
  } catch (err) {
    console.warn('[todos] 保存失败:', err.message);
    return false;
  }
}

/**
 * 跨天整理：没做完的顺延到今天，做完的归档。
 * 返回 true 表示列表确实变了（该落盘 + 刷新界面）。
 */
function rollover(store, today = dayKey(Date.now())) {
  let changed = false;
  const kept = [];

  for (const item of store.items) {
    if (item.done) {
      if (item.day === today) {
        kept.push(item);
      } else {
        changed = true; // 昨天完成的：归档，不再占地方
      }
      continue;
    }
    if (item.day !== today) {
      item.day = today; // 没做的：顺延到今天
      changed = true;
    }
    kept.push(item);
  }

  if (kept.length !== store.items.length) changed = true;
  store.items = kept;
  return changed;
}

/** 新增一条（新条目放最前面，符合“刚记的事最显眼”） */
function add(store, text, today = dayKey(Date.now())) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  if (store.items.length >= MAX_ITEMS) return null;

  const item = {
    id: makeId(),
    text: clean.slice(0, MAX_TEXT),
    done: false,
    day: today,
    createdAt: new Date().toISOString(),
    doneAt: null,
    updatedAt: Date.now(),
    remoteId: null,
    remoteAt: 0,
  };
  store.items.unshift(item);
  return item;
}

/** 勾选 / 取消勾选；顺手把 day 对齐到今天（否则第二天会被当成“老任务”） */
function toggle(store, id, today = dayKey(Date.now())) {
  const item = store.items.find((it) => it.id === id);
  if (!item) return null;
  item.done = !item.done;
  item.day = today;
  item.doneAt = item.done ? new Date().toISOString() : null;
  item.updatedAt = Date.now();
  return item;
}

function remove(store, id) {
  const before = store.items.length;
  store.items = store.items.filter((it) => it.id !== id);
  return store.items.length !== before;
}

/** 只删已完成的（未完成的保留），返回删了几条 */
function clearDone(store) {
  const before = store.items.length;
  store.items = store.items.filter((it) => !it.done);
  return before - store.items.length;
}

function counts(store) {
  const total = store.items.length;
  const done = store.items.reduce((n, it) => n + (it.done ? 1 : 0), 0);
  return { total, done };
}

module.exports = {
  dayKey,
  load,
  save,
  rollover,
  add,
  toggle,
  remove,
  clearDone,
  counts,
  DATA_DIR,
  FILE,
  MAX_ITEMS,
  MAX_TEXT,
};
