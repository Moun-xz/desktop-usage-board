/* 录制页：拿桌面实时流，按帧率把「裁剪区域」画到 canvas，再逐帧回传主进程。 */
(async () => {
  const query = new URLSearchParams(location.search);
  const durationMs = Number(query.get('duration') || 7000);
  const fps = Number(query.get('fps') || 8);
  const log = (m) => window.rec.log(m);

  try {
    const source = await window.rec.source();
    const region = await window.rec.region();
    log(`source=${source.name} dpr=${source.dpr} region=${region.w}x${region.h}`);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          maxFrameRate: 30,
        },
      },
    });

    const video = document.getElementById('v');
    video.srcObject = stream;
    await video.play();
    if (video.readyState < 2) {
      await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
    }

    // 视频尺寸就是屏幕物理尺寸；按 region 裁一块出来
    const canvas = document.getElementById('c');
    const dpr = source.dpr || 1;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = Math.min(region.x, vw);
    const sy = Math.min(region.y, vh);
    const sw = Math.max(1, Math.min(region.w, vw - sx));
    const sh = Math.max(1, Math.min(region.h, vh - sy));

    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    log(`video=${vw}x${vh} crop=${sx},${sy},${sw},${sh}`);

    const started = Date.now();
    let count = 0;
    const timer = setInterval(() => {
      try {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
        window.rec.frame(canvas.toDataURL('image/png'));
        count += 1;
      } catch (err) {
        log('抓帧失败: ' + err.message);
      }
      if (Date.now() - started >= durationMs) {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        log(`抓了 ${count} 帧`);
        window.rec.done();
      }
    }, 1000 / fps);
  } catch (err) {
    log('初始化失败: ' + (err && err.message ? err.message : err));
    window.rec.done();
  }
})();
