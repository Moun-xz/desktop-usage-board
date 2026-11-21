'use strict';

/* ------------------------------------------------------------------
   微软账号登录（OAuth 2.0 · Device Code Flow）

   为什么用设备码流程：
   - 桌面小组件没有浏览器回调地址（不用开本地端口、也不用注册 redirect URI）；
   - 它给一个 8 位码 + 一个网址，你在浏览器里登录一次，这边自动拿到令牌。

   需要的权限（delegated）：Tasks.ReadWrite + offline_access
   可选的租户：consumers（个人微软账号）/ common（个人 + 工作账号）

   令牌存 data/ms-token.json（已加入 .gitignore，不会上传）。
   这个文件等价于「登录态」，泄露了别人就能读写你的待办，别提交。
------------------------------------------------------------------- */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { URLSearchParams } = require('node:url');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'ms-token.json');

const AUTH_HOST = 'https://login.microsoftonline.com';
const SCOPES = 'Tasks.ReadWrite offline_access';
const DEFAULT_TENANT = 'consumers';

function buildUrl(tenant, suffix) {
  const t = tenant || DEFAULT_TENANT;
  return `${AUTH_HOST}/${encodeURIComponent(t)}/oauth2/v2.0/${suffix}`;
}

/** 极简 form POST：只依赖 Node 内置 https，不引第三方包 */
function postForm(url, params, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
          accept: 'application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 512 * 1024) req.destroy(new Error('响应过大'));
        });
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          if (res.statusCode >= 200 && res.statusCode < 300 && json) return resolve(json);
          const err = new Error((json && (json.error_description || json.error)) || `HTTP ${res.statusCode}`);
          err.code = json && json.error;
          err.status = res.statusCode;
          reject(err);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** 第一步：拿设备码（user_code 给用户看，device_code 自己留着轮询） */
async function startDeviceCode(clientId, tenant = DEFAULT_TENANT) {
  if (!clientId) throw new Error('还没填 Client ID');
  const data = await postForm(buildUrl(tenant, 'devicecode'), {
    client_id: clientId,
    scope: SCOPES,
  });
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: Number(data.expires_in) || 900,
    interval: Number(data.interval) || 5,
    message: data.message,
  };
}

/**
 * 第二步：轮询换令牌。
 * 微软会返回 authorization_pending / slow_down，这些属于“还没点完”，继续等。
 */
async function pollDeviceCode(clientId, deviceCode, intervalSeconds = 5, tenant = DEFAULT_TENANT) {
  const interval = Math.max(2, Number(intervalSeconds) || 5) * 1000;
  const deadline = Date.now() + 15 * 60 * 1000;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  while (Date.now() < deadline) {
    try {
      const token = await postForm(buildUrl(tenant, 'token'), {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: deviceCode,
      });
      const normalized = normalizeToken(token);
      if (!normalized) throw new Error('登录响应里没有 access_token');
      saveToken(normalized);
      return normalized;
    } catch (err) {
      if (err.code === 'authorization_pending') {
        await wait(interval);
        continue;
      }
      if (err.code === 'slow_down') {
        await wait(interval + 3000);
        continue;
      }
      throw err;
    }
  }
  throw new Error('登录超时，请重新发起登录');
}

function normalizeToken(raw) {
  if (!raw || !raw.access_token) return null;
  const expiresIn = Number(raw.expires_in) || 3600;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token || (raw.refresh_token === undefined ? null : raw.refresh_token),
    expiresAt: Date.now() + expiresIn * 1000,
    scope: raw.scope || SCOPES,
  };
}

function loadToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (!raw || (!raw.accessToken && !raw.refreshToken)) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveToken(token) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${TOKEN_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(token, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, TOKEN_FILE);
    return true;
  } catch (err) {
    console.warn('[ms-auth] 保存令牌失败:', err.message);
    return false;
  }
}

function clearToken() {
  try {
    fs.rmSync(TOKEN_FILE, { force: true });
  } catch {
    /* 忽略 */
  }
}

function hasToken() {
  const t = loadToken();
  return Boolean(t && t.refreshToken);
}

/** 用 refresh_token 换一个新的 access_token（refresh_token 也会滚新的，记得存回去） */
async function refresh(clientId, tenant = DEFAULT_TENANT) {
  const cached = loadToken();
  if (!cached || !cached.refreshToken) throw new Error('还没登录微软待办');
  const data = await postForm(buildUrl(tenant, 'token'), {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: cached.refreshToken,
    scope: SCOPES,
  });
  const next = normalizeToken(data);
  next.refreshToken = next.refreshToken || cached.refreshToken;
  saveToken(next);
  return next;
}

/** 给 Graph 模块用：保证返回一个「还有效」的 access token */
async function getAccessToken(clientId, tenant = DEFAULT_TENANT) {
  const cached = loadToken();
  if (!cached) throw new Error('还没登录微软待办');
  if (cached.accessToken && cached.expiresAt && cached.expiresAt - Date.now() > 60 * 1000) {
    return cached.accessToken;
  }
  const next = await refresh(clientId, tenant);
  return next.accessToken;
}

module.exports = {
  startDeviceCode,
  pollDeviceCode,
  getAccessToken,
  loadToken,
  saveToken,
  clearToken,
  hasToken,
  refresh,
  TOKEN_FILE,
  SCOPES,
  DEFAULT_TENANT,
};
