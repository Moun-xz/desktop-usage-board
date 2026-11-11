'use strict';
/**
 * 把 docs/architecture.html 渲染成一张 PNG（2 倍图）。
 *
 *   electron tools/render-diagram.js [输出路径]
 *
 * 之所以用 Electron 而不是截图工具：这个页面就是普通 HTML/CSS，
 * 用 Electron 自己的离屏窗口渲染，字体、圆角、阴影和网页里看到的完全一致，
 * 还能直接输出 2x 高清图。
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 注意：不要用 force-device-scale-factor —— 它会把 screen API 的逻辑分辨率也改掉，
// 窗口尺寸被裁到工作区，最终截图缺一块。这里就让窗口按物理屏幕大小开，
// capturePage() 会自动按系统 dpr（本机 1.5）输出，字依然清晰。
app.disableHardwareAcceleration(); // 离屏渲染更稳，避免 DWM 合成干扰

const OUT = process.argv[2] || path.join(__dirname, '..', 'assets', 'architecture.png');
const PAGE = path.join(__dirname, '..', 'docs', 'architecture.html');
const WIDTH = 1700;
const HEIGHT = 1010;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    backgroundColor: '#0b0d12',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
  });

  await win.loadFile(PAGE);
  // 等字体与布局稳定
  await new Promise((r) => setTimeout(r, 900));

  const image = await win.capturePage();
  const png = image.toPNG();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png);
  console.log(`saved ${OUT} (${image.getSize().width}x${image.getSize().height}, ${png.length} bytes)`);

  win.destroy();
  app.quit();
});
