/**
 * 录制桌面素材 → 逐帧 PNG（用 Electron 的屏幕捕获，能拍到 acrylic 窗口）。
 *
 * 用法：
 *   electron tools\record-demo.js <输出目录> <毫秒> <帧率> <x> <y> <w> <h>
 * 其中 x/y/w/h 是「逻辑像素」的裁剪区域（DIP），内部会乘以系统缩放。
 *
 * 为什么不用 desktopCapturer 逐帧抓：一次要 600ms（≈1.6fps），视频会卡；
 * 这里改成 getUserMedia 拿实时流 + canvas 定时采样，能稳定 8 fps。
 */
const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const outDir = process.argv[2] || path.join(app.getPath('temp'), 'demo-frames');
const durationMs = Number(process.argv[3] || 7000);
const fps = Number(process.argv[4] || 8);
const crop = {
  x: Number(process.argv[5] || 0),
  y: Number(process.argv[6] || 0),
  w: Number(process.argv[7] || 0),
  h: Number(process.argv[8] || 0),
};

let win = null;
let frames = 0;
let expected = 0;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  expected = Math.round((durationMs / 1000) * fps);

  const display = screen.getPrimaryDisplay();
  const dpr = display.scaleFactor || 1;
  const region = crop.w > 0 && crop.h > 0
    ? { x: Math.round(crop.x * dpr), y: Math.round(crop.y * dpr), w: Math.round(crop.w * dpr), h: Math.round(crop.h * dpr) }
    : { x: 0, y: 0, w: Math.round(display.size.width * dpr), h: Math.round(display.size.height * dpr) };

  ipcMain.handle('rec:source', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 16, height: 16 } });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src) throw new Error('没有可用的屏幕源');
    return { id: src.id, name: src.name, dpr };
  });

  ipcMain.handle('rec:region', () => region);

  ipcMain.on('rec:frame', (_event, dataUrl) => {
    const comma = String(dataUrl).indexOf(',');
    const base64 = comma >= 0 ? String(dataUrl).slice(comma + 1) : '';
    if (!base64) return;
    const file = path.join(outDir, `f${String(frames).padStart(3, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    frames += 1;
  });

  ipcMain.on('rec:log', (_event, message) => console.log('[page]', message));

  ipcMain.on('rec:done', () => {
    console.log(`[record] 完成 ${frames} 帧（目标 ${expected}）→ ${outDir} 区域 ${region.w}x${region.h} @${dpr}x`);
    app.quit();
  });

  win = new BrowserWindow({
    show: false,
    opacity: 0,
    width: 480,
    height: 320,
    skipTaskbar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'record-demo-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: false,
    },
  });
  win.setOpacity(0);
  await win.loadFile(path.join(__dirname, 'record-demo.html'), {
    query: { duration: String(durationMs), fps: String(fps) },
  });
  win.showInactive();
  win.setOpacity(0);
});

process.on('uncaughtException', (err) => {
  console.error('[record] 异常:', err && err.stack ? err.stack : err);
  app.quit();
});
