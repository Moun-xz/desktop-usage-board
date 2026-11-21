'use strict';

/* ------------------------------------------------------------------
   今日待办 ⇄ 微软待办（Microsoft To Do）双向同步

   目标：看板上就是「今天的事」，微软待办里是全部的事；两边改哪边都算数。

   规则（尽量简单、可预期）：
   1. 远程有、本地没有 → 拉进来（已完成的也拉，勾选状态照搬）；
   2. 本地有、远程没有 → 推上去（只推「今天」的，历史任务不往回补）；
   3. 两边都有 → 比时间戳，谁后改的听谁的（last-write-wins）；
   4. 远程删了 → 本地也删；本地删了 → 由主进程立刻删远程（见 removeRemote）。

   时间戳来源：
   - 本地改动的时刻：item.updatedAt（毫秒）
   - 远程最后修改时刻：item.remoteAt（毫秒，来自 Graph 的 lastModifiedDateTime）
------------------------------------------------------------------- */

const graph = require('./ms-todo');
const store = require('./todo-store');

// 同一时刻只允许一个同步在跑，避免两次同步互相覆盖
let running = false;
let lastResult = null;

const toMs = (iso) => {
  const ms = Date.parse(iso || '');
  return Number.isFinite(ms) ? ms : 0;
};

function isSyncing() {
  return running;
}

function describeError(err) {
  if (!err) return '未知错误';
  if (err.status === 401) return '登录已过期，请在菜单里重新登录';
  if (err.status === 403) return '没有权限（检查 Azure 应用是否加了 Tasks.ReadWrite）';
  if (err.status === 404) return '清单或任务不存在（可能刚被删除）';
  return err.message || String(err);
}

/**
 * 执行一次双向同步。
 * @param {{items: Array}} todoStore 内存里的待办 store（会被就地修改）
 * @param {{clientId: string, tenant?: string, listId: string, today: string}} options
 */
async function sync(todoStore, options) {
  if (running) return { skipped: true, ...(lastResult || {}) };
  const { clientId, tenant, listId, today } = options;
  if (!clientId || !listId) throw new Error('还没有配置 Client ID 或清单');

  running = true;
  const result = { pulled: 0, pushed: 0, updated: 0, removed: 0, at: Date.now() };
  try {
    const remote = await graph.listTasks(clientId, tenant, listId);
    const remoteById = new Map(remote.map((t) => [t.id, t]));

    // ---------- 1) 远程 → 本地 ----------
    for (const r of remote) {
      if (!r.title) continue;
      const remoteMs = toMs(r.lastModifiedDateTime);
      const existing = todoStore.items.find((it) => it.remoteId === r.id);

      if (!existing) {
        todoStore.items.unshift({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          text: r.title.slice(0, store.MAX_TEXT),
          done: r.done,
          day: today,
          createdAt: r.createdDateTime || new Date().toISOString(),
          doneAt: r.done ? new Date().toISOString() : null,
          updatedAt: remoteMs || Date.now(),
          remoteId: r.id,
          remoteAt: remoteMs,
        });
        result.pulled += 1;
        continue;
      }

      // 远程比本地「两边都知道的时间」更新 → 用远程的
      const localKnown = Math.max(existing.remoteAt || 0, existing.updatedAt || 0);
      if (remoteMs > localKnown && (existing.text !== r.title || existing.done !== r.done)) {
        existing.text = r.title.slice(0, store.MAX_TEXT);
        existing.done = r.done;
        existing.doneAt = r.done ? existing.doneAt || new Date().toISOString() : null;
        existing.updatedAt = remoteMs;
        existing.remoteAt = remoteMs;
        result.updated += 1;
      } else {
        existing.remoteAt = Math.max(existing.remoteAt || 0, remoteMs);
      }
    }

    // ---------- 2) 远程已删除 → 本地删 ----------
    const before = todoStore.items.length;
    todoStore.items = todoStore.items.filter((it) => !it.remoteId || remoteById.has(it.remoteId));
    result.removed += before - todoStore.items.length;

    // ---------- 3) 本地 → 远程 ----------
    for (const item of todoStore.items) {
      // 新条目：只把「今天」的推上去，别把历史任务一次性灌进微软待办
      if (!item.remoteId) {
        if (item.day !== today) continue;
        const created = await graph.createTask(clientId, tenant, listId, { title: item.text });
        item.remoteId = created.id;
        item.remoteAt = toMs(created.lastModifiedDateTime) || Date.now();
        item.updatedAt = Math.max(item.updatedAt || 0, item.remoteAt);
        result.pushed += 1;
        if (item.done) {
          const doneTask = await graph.updateTask(clientId, tenant, listId, created.id, { status: 'completed' });
          item.remoteAt = toMs(doneTask.lastModifiedDateTime) || Date.now();
        }
        continue;
      }

      const r = remoteById.get(item.remoteId);
      if (!r || !item.updatedAt || item.updatedAt <= (item.remoteAt || 0)) continue;

      const patch = {};
      if (r.title !== item.text) patch.title = item.text;
      if (r.done !== item.done) patch.status = item.done ? 'completed' : 'notStarted';
      if (!Object.keys(patch).length) continue;

      const updated = await graph.updateTask(clientId, tenant, listId, item.remoteId, patch);
      item.remoteAt = toMs(updated.lastModifiedDateTime) || Date.now();
      item.updatedAt = Math.max(item.updatedAt, item.remoteAt);
      result.pushed += 1;
    }

    lastResult = result;
    return result;
  } finally {
    running = false;
  }
}

/** 本地删除一条时，同步把远程也删掉（失败不影响本地，下次同步会看到远程还在） */
async function removeRemote(options, remoteId) {
  if (!remoteId) return false;
  const { clientId, tenant, listId } = options;
  if (!clientId || !listId) return false;
  try {
    await graph.deleteTask(clientId, tenant, listId, remoteId);
    return true;
  } catch (err) {
    console.warn('[todo-sync] 删除远程任务失败:', describeError(err));
    return false;
  }
}

module.exports = { sync, removeRemote, isSyncing, describeError };
