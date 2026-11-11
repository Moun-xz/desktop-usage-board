'use strict';

// 天气：Open-Meteo 免费接口（无需 API Key、无需注册）
//   1) geocoding-api.open-meteo.com  把城市名解析成经纬度
//   2) api.open-meteo.com            取当前气温 + 今天最高/最低
// 网络失败时沿用上一次成功的结果（data/weather.json 里缓存），不会把界面搞空。

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { DATA_DIR } = require('./settings');

const CACHE_FILE = path.join(DATA_DIR, 'weather.json');
const FRESH_MS = 10 * 60 * 1000; // 10 分钟内不重复请求
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// WMO 天气代码 → 图标 + 中文描述
const CODES = {
  0: ['☀️', '晴'],
  1: ['🌤️', '大部晴朗'],
  2: ['⛅', '多云'],
  3: ['☁️', '阴'],
  45: ['🌫️', '雾'],
  48: ['🌫️', '雾凇'],
  51: ['🌦️', '小毛毛雨'],
  53: ['🌦️', '毛毛雨'],
  55: ['🌧️', '大毛毛雨'],
  56: ['🌧️', '冻毛毛雨'],
  57: ['🌧️', '强冻毛毛雨'],
  61: ['🌦️', '小雨'],
  63: ['🌧️', '中雨'],
  65: ['🌧️', '大雨'],
  66: ['🌧️', '冻雨'],
  67: ['🌧️', '强冻雨'],
  71: ['🌨️', '小雪'],
  73: ['🌨️', '中雪'],
  75: ['❄️', '大雪'],
  77: ['🌨️', '米雪'],
  80: ['🌦️', '小阵雨'],
  81: ['🌧️', '阵雨'],
  82: ['⛈️', '强阵雨'],
  85: ['🌨️', '小阵雪'],
  86: ['❄️', '强阵雪'],
  95: ['⛈️', '雷阵雨'],
  96: ['⛈️', '雷阵雨伴冰雹'],
  99: ['⛈️', '强雷暴伴冰雹'],
};

// 夜间把太阳类图标换成月亮
const NIGHT = { 0: ['🌙', '晴'], 1: ['🌙', '大部晴朗'], 2: ['☁️', '多云'] };

const describe = (code, isDay) => {
  const table = !isDay && NIGHT[code] ? NIGHT : null;
  if (table) return { icon: table[0], desc: table[1] };
  const hit = CODES[code];
  return hit ? { icon: hit[0], desc: hit[1] } : { icon: '🌡️', desc: '未知' };
};

/** 极简 GET+JSON，8 秒超时，只认 https */
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'desktop-usage-board/1.0 (personal widget)' }, timeout: 8000 },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 512 * 1024) req.destroy(new Error('response too large'));
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error('bad json'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    /* 缓存写不进去不影响使用 */
  }
}

// Open-Meteo 的城市库对一部分中文地名（例如「淮南」）没有条目，这里做一层别名兜底：
// 先查原名，查不到再去掉「市/县/区」后缀，最后换成英文名再查。
const ALIASES = {
  北京: 'Beijing', 上海: 'Shanghai', 广州: 'Guangzhou', 深圳: 'Shenzhen', 天津: 'Tianjin',
  南京: 'Nanjing', 杭州: 'Hangzhou', 合肥: 'Hefei', 淮南: 'Huainan', 蚌埠: 'Bengbu',
  芜湖: 'Wuhu', 武汉: 'Wuhan', 西安: 'Xian', 成都: 'Chengdu', 重庆: 'Chongqing',
  苏州: 'Suzhou', 青岛: 'Qingdao', 长沙: 'Changsha', 厦门: 'Xiamen', 郑州: 'Zhengzhou',
  济南: 'Jinan', 大连: 'Dalian', 沈阳: 'Shenyang', 哈尔滨: 'Harbin', 昆明: 'Kunming',
  福州: 'Fuzhou', 南昌: 'Nanchang', 太原: 'Taiyuan', 石家庄: 'Shijiazhuang', 兰州: 'Lanzhou',
  贵阳: 'Guiyang', 南宁: 'Nanning', 海口: 'Haikou', 台北: 'Taipei', 香港: 'Hong Kong',
  澳门: 'Macau', 无锡: 'Wuxi', 宁波: 'Ningbo', 常州: 'Changzhou', 徐州: 'Xuzhou',
};

/** 生成候选查询名：原名 → 去掉行政区后缀 → 英文别名 */
function cityCandidates(city) {
  const base = city.trim();
  const bare = base.replace(/(市|地区|自治州|县|区)$/u, '');
  const list = [base, bare, ALIASES[base], ALIASES[bare]].filter(Boolean);
  return [...new Set(list)];
}

async function resolveCity(city, cache) {
  if (cache.geo && cache.geo.city === city) return cache.geo;
  for (const candidate of cityCandidates(city)) {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(candidate)}&count=1&language=zh&format=json`;
    let json = null;
    try {
      json = await getJson(url);
    } catch {
      continue; // 单个名字查不到/超时，换下一个
    }
    const hit = json && Array.isArray(json.results) ? json.results[0] : null;
    if (!hit) continue;
    const geo = {
      city, // 显示名用用户填的那个（「淮南」而不是「Huainan」）
      name: hit.name || city,
      admin1: hit.admin1 || '',
      latitude: hit.latitude,
      longitude: hit.longitude,
    };
    cache.geo = geo;
    return geo;
  }
  throw new Error(`找不到城市：${city}（可在 data/settings.json 里改成拼音或附近大城市）`);
}

/**
 * 取天气。成功返回 { ok:true, city, temp, feels, desc, icon, high, low, updatedAt }。
 * 失败返回 { ok:false, error }，调用方可继续用缓存里上一次的数据。
 */
async function fetchWeather(city, options = {}) {
  const cache = options.cache || loadCache();
  const force = Boolean(options.force);

  if (!force && cache.data && cache.data.city === city && Date.now() - (cache.data.updatedAt || 0) < FRESH_MS) {
    return cache.data;
  }

  const geo = await resolveCity(city, cache);
  const params = [
    `latitude=${geo.latitude}`,
    `longitude=${geo.longitude}`,
    'current=temperature_2m,apparent_temperature,weather_code,is_day',
    'daily=temperature_2m_max,temperature_2m_min',
    'timezone=auto',
    'forecast_days=1',
  ].join('&');
  const json = await getJson(`${FORECAST_URL}?${params}`);

  const cur = json && json.current;
  if (!cur) throw new Error('返回里没有 current 字段');
  const daily = (json.daily && json.daily.temperature_2m_max) || [];
  const { icon, desc } = describe(Number(cur.weather_code), Number(cur.is_day) === 1);

  const data = {
    ok: true,
    city: geo.city || city,
    admin1: geo.admin1,
    temp: Math.round(Number(cur.temperature_2m)),
    feels: Math.round(Number(cur.apparent_temperature)),
    code: Number(cur.weather_code),
    icon,
    desc,
    high: daily.length ? Math.round(Number(daily[0])) : null,
    low: daily.length && json.daily.temperature_2m_min ? Math.round(Number(json.daily.temperature_2m_min[0])) : null,
    updatedAt: Date.now(),
  };

  cache.data = data;
  saveCache(cache);
  return data;
}

/** 启动时先把上次的结果拿来做首屏，避免空白 */
function cached() {
  const cache = loadCache();
  return cache.data && cache.data.ok ? { ...cache.data, cached: true } : null;
}

module.exports = { fetchWeather, cached, FRESH_MS, CODES };
