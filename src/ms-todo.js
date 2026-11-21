'use strict';

/* ------------------------------------------------------------------
   Microsoft Graph · To Do 接口封装

   只用到四件事：
   - 列出清单（lists）
   - 列出某个清单里的任务（tasks）
   - 新建 / 改 / 删任务

   文档：https://learn.microsoft.com/graph/api/resources/todo-overview
   注意：这是「委托权限」接口（以登录用户的身份读写），所以必须先过 ms-auth。
------------------------------------------------------------------- */

const https = require('node:https');
const auth = require('./ms-auth');

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** 通用请求：JSON in / JSON out，401 时自动刷新一次令牌再重试 */
function request(clientId, tenant, method, pathOrUrl, body) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const send = (token) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = https.request(
        url,
        {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          },
          timeout: 20000,
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 4 * 1024 * 1024) req.destroy(new Error('响应过大'));
          });
          res.on('end', () => {
            let json = null;
            try {
              json = raw ? JSON.parse(raw) : null;
            } catch {
              json = null;
            }
            if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
            const err = new Error((json && json.error && json.error.message) || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            reject(err);
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

  return auth
    .getAccessToken(clientId, tenant)
    .then(send)
    .catch(async (err) => {
      if (err.status !== 401) throw err;
      await auth.refresh(clientId, tenant);
      return send(await auth.getAccessToken(clientId, tenant));
    });
}

/** 所有清单（默认清单一般叫「任务」） */
async function listLists(clientId, tenant) {
  const data = await request(clientId, tenant, 'GET', '/me/todo/lists?$top=50');
  return (data && data.value ? data.value : []).map((l) => ({
    id: l.id,
    name: l.displayName || '(未命名)',
    wellknown: l.wellknownListName || 'none',
  }));
}

/** 某个清单里的任务；自动翻页，最多 200 条（小组件也放不下更多） */
async function listTasks(clientId, tenant, listId) {
  const items = [];
  let url = `/me/todo/lists/${encodeURIComponent(listId)}/tasks?$top=100`;
  while (url && items.length < 200) {
    const data = await request(clientId, tenant, 'GET', url);
    const page = (data && data.value) || [];
    items.push(...page);
    url = data && data['@odata.nextLink'];
  }
  return items.slice(0, 200).map((t) => ({
    id: t.id,
    title: (t.title || '').trim(),
    status: t.status || 'notStarted',
    done: t.status === 'completed',
    createdDateTime: t.createdDateTime || '',
    lastModifiedDateTime: t.lastModifiedDateTime || '',
  }));
}

async function createTask(clientId, tenant, listId, { title, status }) {
  const body = { title };
  if (status) body.status = status;
  const t = await request(clientId, tenant, 'POST', `/me/todo/lists/${encodeURIComponent(listId)}/tasks`, body);
  return {
    id: t.id,
    title: (t.title || '').trim(),
    done: t.status === 'completed',
    lastModifiedDateTime: t.lastModifiedDateTime || '',
  };
}

async function updateTask(clientId, tenant, listId, taskId, patch) {
  const t = await request(
    clientId,
    tenant,
    'PATCH',
    `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    patch
  );
  return {
    id: t.id,
    title: (t.title || '').trim(),
    done: t.status === 'completed',
    lastModifiedDateTime: t.lastModifiedDateTime || '',
  };
}

async function deleteTask(clientId, tenant, listId, taskId) {
  await request(clientId, tenant, 'DELETE', `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`);
  return true;
}

module.exports = { request, listLists, listTasks, createTask, updateTask, deleteTask };
