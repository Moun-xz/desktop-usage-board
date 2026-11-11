'use strict';

/* ------------------------------------------------------------------
   开发辅助：给"用户真正看到的样子"拍一张整屏照片
   （Electron 的桌面捕获能拍到 acrylic 毛玻璃窗口，普通 BitBlt 截图拍不到）

   用法：
     node_modules\electron\dist\electron.exe tools\deskshot.js out.png
   注意：在 DSH 终端里要先清掉 ELECTRON_RUN_AS_NODE
------------------------------------------------------------------ */

const { app, desktopCapturer, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outPath = process.argv[process.argv.length - 1];
const target = outPath && outPath.endsWith('.png') ? outPath : path.join(process.cwd(), 'deskshot.png');

app.whenReady().then(async () => {
  try {
    const display = screen.getPrimaryDisplay();
    const dpr = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.size.width * dpr),
        height: Math.round(display.size.height * dpr),
      },
    });
    const screenSource = sources[0];
    if (!screenSource) throw new Error('没有找到屏幕源');
    fs.writeFileSync(path.resolve(target), screenSource.thumbnail.toPNG());
    console.log('[deskshot] ->', target, JSON.stringify(screenSource.thumbnail.getSize()));
  } catch (err) {
    console.error('[deskshot] 失败:', err.message);
  } finally {
    app.quit();
  }
});
