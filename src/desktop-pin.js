'use strict';

/* ------------------------------------------------------------------
   「固定到桌面」模式的底层支持

   目标：窗口一直在屏幕上，但不盖在其它应用窗口上面（像 macOS 桌面小组件）。
   Electron 没有 moveBottom()，这里用一个常驻的 PowerShell 小助手调用
   user32.SetWindowPos(hwnd, HWND_BOTTOM, ...)，需要时往它的 stdin 写一行 "bottom"。
   助手只在第一次用到时启动，退出应用时关掉。
------------------------------------------------------------------ */

const { spawn } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'tools', 'send-to-bottom.ps1');

let child = null;
let hwndHex = null;

/** 记录窗口句柄（win.getNativeWindowHandle() 返回的小端 Buffer） */
function setTarget(nativeHandle) {
  if (!nativeHandle || nativeHandle.length < 8) return;
  try {
    hwndHex = nativeHandle.readBigUInt64LE(0).toString(16);
  } catch {
    hwndHex = null;
  }
}

function ensureChild() {
  if (child && child.exitCode === null && !child.killed) return child;
  if (!hwndHex) return null;

  child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, hwndHex],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] }
  );

  child.on('error', (err) => {
    console.warn('[pin] 无法启动置底助手:', err.message);
    child = null;
  });
  child.on('exit', () => {
    child = null;
  });

  return child;
}

/** 把窗口压到 z 序最底层（桌面层） */
function sendToBottom() {
  const proc = ensureChild();
  if (!proc) return;
  try {
    proc.stdin.write('bottom\n');
  } catch {
    /* 助手刚退出就算了，下次再起 */
  }
}

function stop() {
  if (!child) return;
  try {
    child.stdin.end();
  } catch {
    /* ignore */
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  child = null;
}

module.exports = { setTarget, sendToBottom, stop };
