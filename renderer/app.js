'use strict';

/* ------------------------------------------------------------------
   渲染进程：只负责画界面，数据全部由主进程每秒推送
------------------------------------------------------------------ */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const params = new URLSearchParams(location.search);
document.documentElement.dataset.glass = params.get('glass') || 'acrylic';

const els = {
  date: document.getElementById('date'),
  heroValue: document.getElementById('heroValue'),
  goalFill: document.getElementById('goalFill'),
  goalText: document.getElementById('goalText'),
  session: document.getElementById('session'),
  avg: document.getElementById('avg'),
  battery: document.getElementById('battery'),
  bars: document.getElementById('bars'),
  labels: document.getElementById('labels'),
  more: document.getElementById('more'),
  pin: document.getElementById('pin'),
  wx: document.getElementById('wx'),
  wxIcon: document.getElementById('wxIcon'),
  wxTemp: document.getElementById('wxTemp'),
  wxMeta: document.getElementById('wxMeta'),
};

const state = { built: false, cols: [] };
let lastBattery = null;

// ------------------------------------------------------------ 格式化

const pad2 = (n) => String(n).padStart(2, '0');

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`;
}

function splitSeconds(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** 大号数字：6 小时 21 分 */
function heroHTML(seconds) {
  const { h, m } = splitSeconds(seconds);
  if (h > 0) {
    return `${h}<span class="unit">小时</span><span class="minute">${pad2(m)}</span><span class="unit">分</span>`;
  }
  return `<span class="minute">${m}</span><span class="unit">分钟</span>`;
}

/** 文案用：6 小时 21 分 / 21 分钟 */
function fmtLong(seconds) {
  const { h, m } = splitSeconds(seconds);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

/**
 * 本次开机：06:21（只到分钟）
 * 主进程为了省 CPU 每分钟才推一次数据，所以这里不再显示秒，
 * 否则秒数会「冻住一分钟再跳」，看起来像卡住了。
 */
function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}`;
}

/** 日均：5.2 小时 */
function fmtAvg(seconds) {
  if (!seconds) return '—';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} 分钟`;
  return `${hours.toFixed(1)} 小时`;
}

function fmtBarTitle(day) {
  const d = new Date(day.date);
  const tail = day.estimated ? '（按开机时长估算）' : '';
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]} · ${fmtLong(day.seconds)}${tail}`;
}

// ------------------------------------------------------------ 图表

function buildChart(days) {
  const barFrag = document.createDocumentFragment();
  const labelFrag = document.createDocumentFragment();
  state.cols = [];

  days.forEach((day) => {
    const col = document.createElement('div');
    col.className = 'col';
    const bar = document.createElement('div');
    bar.className = 'bar';
    col.appendChild(bar);
    barFrag.appendChild(col);

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = WEEKDAYS[day.weekday];
    labelFrag.appendChild(label);

    state.cols.push({ bar, label });
  });

  els.bars.replaceChildren(barFrag);
  els.labels.replaceChildren(labelFrag);
}

function renderChart(days, goalSeconds) {
  // 纵轴至少留到「每日目标」的高度：即使今天只用到一半，也能看出离目标还有多远
  const max = Math.max(3600, goalSeconds || 0, ...days.map((d) => d.seconds));

  days.forEach((day, i) => {
    const { bar, label } = state.cols[i];
    const hasValue = day.seconds > 60;
    const height = hasValue ? Math.max(8, (day.seconds / max) * 100) : 3;

    bar.style.height = `${height}%`;
    bar.className = `bar${day.isToday ? ' today' : hasValue ? ' past' : ' empty'}`;
    bar.title = fmtBarTitle(day);

    label.className = `label${day.isToday ? ' today' : ''}`;
    label.textContent = WEEKDAYS[day.weekday];
  });
}

// ------------------------------------------------------------ 电量

async function initBattery() {
  try {
    if (typeof navigator.getBattery !== 'function') return;
    const battery = await navigator.getBattery();
    const paint = () => {
      lastBattery = battery;
      els.battery.textContent = `${Math.round(battery.level * 100)}%`;
      els.battery.title = battery.charging ? '正在充电' : '电池供电';
    };
    ['levelchange', 'chargingchange'].forEach((ev) => battery.addEventListener(ev, paint));
    paint();
  } catch {
    /* 读不到电量就保持 “—”，不影响看板 */
  }
}

// ------------------------------------------------------------ 天气

/** 右上角天气块：图标 + 当前温度 + 一行「城市 · 天气 最低° / 最高°」 */
function renderWeather(w) {
  if (!w) {
    els.wx.hidden = true;
    return;
  }
  els.wx.hidden = false;

  if (!w.ok) {
    els.wx.classList.add('unavailable');
    els.wxIcon.textContent = '🌡️';
    els.wxTemp.textContent = '--°';
    els.wxMeta.textContent = `${w.city || '天气'} · 暂不可用`;
    els.wx.title = '天气获取失败，稍后自动重试（右键菜单 → 天气 → 刷新天气）';
    return;
  }

  els.wx.classList.remove('unavailable');
  els.wxIcon.textContent = w.icon || '🌡️';
  els.wxTemp.textContent = `${w.temp}°`;

  const range = w.high != null && w.low != null ? ` ${w.low}° / ${w.high}°` : '';
  els.wxMeta.textContent = `${w.city} · ${w.desc}${range}`;

  const when = w.updatedAt ? new Date(w.updatedAt) : null;
  const stamp = when ? ` ${pad2(when.getHours())}:${pad2(when.getMinutes())}` : '';
  els.wx.title = `体感 ${w.feels}° · 更新时间${stamp}${w.cached ? '（缓存）' : ''}`;
}

// ------------------------------------------------------------ 主渲染

function render(payload) {
  if (!state.built) {
    buildChart(payload.days);
    state.built = true;
  }

  // 透明度档位（菜单 → 透明度），由主进程随数据一起推下来
  if (payload.veil) document.documentElement.dataset.veil = payload.veil;

  // 天气（可在菜单 → 天气 里关掉）
  renderWeather(payload.weather);

  // 顶部图钉：亮起 = 固定在桌面（不盖住其它应用）
  els.pin.classList.toggle('active', Boolean(payload.pinned));
  els.pin.title = payload.pinned
    ? '已固定到桌面 · 点击取消'
    : '固定到桌面（不挡住其它窗口）';

  els.date.textContent = fmtDate(payload.now);
  els.heroValue.innerHTML = heroHTML(payload.todaySeconds);
  els.heroValue.title = `今日活跃使用 ${fmtLong(payload.todaySeconds)}`;

  const percent = payload.goalSeconds
    ? (payload.todaySeconds / payload.goalSeconds) * 100
    : 0;
  els.goalFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  els.goalFill.style.opacity = percent > 100 ? '0.85' : '1';

  const goalHours = Math.round(payload.goalSeconds / 3600);
  const remain = payload.goalSeconds - payload.todaySeconds;
  const percentText = `${Math.round(percent)}%`;
  els.goalText.textContent =
    remain >= 0
      ? `${percentText} · 目标 ${goalHours} 小时 · 还剩 ${fmtLong(remain)}`
      : `${percentText} · 已超出目标 ${fmtLong(-remain)}`;
  els.goalText.title = els.goalText.textContent;

  els.session.textContent = fmtClock(payload.uptimeSeconds);
  els.session.title = '本次开机时长（系统运行时间）';
  els.avg.textContent = fmtAvg(payload.avg7Seconds);
  els.avg.title = '近 7 天有记录日期的平均活跃时长';

  renderChart(payload.days, payload.goalSeconds);
}

// ------------------------------------------------------------ 交互

els.more.addEventListener('click', (event) => {
  event.stopPropagation();
  window.board.openMenu();
});

els.pin.addEventListener('click', (event) => {
  event.stopPropagation();
  window.board.togglePin();
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.board.openMenu();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.board.hide();
});

// ------------------------------------------------------------ 提示气泡

const hintEl = document.getElementById('hint');
let hintTimer = null;

/** 顶部弹出的临时提示（例如「鼠标穿透已开启」） */
function showHint(text) {
  if (!hintEl) return;
  hintEl.textContent = text;
  hintEl.hidden = false;
  // 强制一次样式计算，保证从 opacity:0 过渡到 1
  void hintEl.offsetWidth;
  hintEl.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hintEl.classList.remove('show');
    setTimeout(() => {
      hintEl.hidden = true;
    }, 260);
  }, 4200);
}

window.board.onHint(showHint);

// ------------------------------------------------------------ 启动

window.board.onUpdate(render);
window.board.snapshot().then((payload) => {
  if (payload) render(payload);
});

initBattery();
