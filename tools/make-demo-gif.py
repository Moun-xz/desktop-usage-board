"""
把 tools/record-demo.js 拍下的逐帧 PNG 合成一张 GIF（用于 README 首屏）。

用法：
    python tools/make-demo-gif.py <帧目录> <输出.gif> [裁剪框] [宽] [颜色数] [起始帧] [结束帧]

例：
    # 宽写 0 = 不缩放，直接 1:1 用屏幕物理像素（最清晰，推荐）
    python tools/make-demo-gif.py %TEMP%\\demo-frames assets/demo.gif "10,80,820,600" 0 128

要点（踩过的坑）：
    - 帧是按物理像素拍的（dpr=1.5）。想清晰就别缩放：按 1:1 导出，让 GitHub 按原尺寸显示；
      一旦缩小（例如 823→700），文字边缘和壁纸渐变都会糊。
    - 颜色数别太低：96 色在壁纸渐变上会出现肉眼可见的色块，128 色明显更平滑（代价 +10% 体积）。
    - 必须开抖动（dither）：GIF 只有 256 色，平滑渐变不开抖动会变成"等高线"。
    - 首帧多停 0.3 秒，让读者先看清界面。
"""
import glob
import os
import sys

from PIL import Image

frames_dir = sys.argv[1]
out_path = sys.argv[2]
crop_arg = sys.argv[3] if len(sys.argv) > 3 else ""
target_w = int(sys.argv[4]) if len(sys.argv) > 4 else 0
colors = int(sys.argv[5]) if len(sys.argv) > 5 else 128
start = int(sys.argv[6]) if len(sys.argv) > 6 else 0
end = int(sys.argv[7]) if len(sys.argv) > 7 else None
FRAME_MS = 125

files = sorted(glob.glob(os.path.join(frames_dir, "f*.png")))
if not files:
    raise SystemExit("没有找到帧文件：" + frames_dir)
files = files[start:end]

box = None
if crop_arg:
    box = tuple(int(v) for v in crop_arg.split(","))
    if len(box) != 4:
        raise SystemExit("裁剪框要写成 x,y,x2,y2")

images = []
for file in files:
    im = Image.open(file).convert("RGB")
    if box:
        im = im.crop(box)
    if target_w and target_w != im.width:  # 只有明确要求缩放时才缩放
        im = im.resize((target_w, max(1, round(im.height * target_w / im.width))), Image.LANCZOS)
    images.append(
        im.convert("P", palette=Image.ADAPTIVE, colors=colors, dither=Image.Dither.FLOYDSTEINBERG)
    )

durations = [FRAME_MS] * len(images)
durations[0] += 300  # 首帧多停 0.3s

os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
images[0].save(
    out_path,
    save_all=True,
    append_images=images[1:],
    duration=durations,
    loop=0,
    optimize=True,
    disposal=2,
)

# 校验总时长（Pillow 会把完全相同的帧合并，时长会累加进去）
gif = Image.open(out_path)
total = 0
for i in range(gif.n_frames):
    gif.seek(i)
    total += gif.info.get("duration", FRAME_MS)

size_kb = os.path.getsize(out_path) / 1024
print(
    f"{out_path}  {len(images)} 帧 → {gif.n_frames} 个唯一帧  "
    f"{images[0].width}x{images[0].height}  {size_kb:.0f} KB  总时长 {total/1000:.1f}s"
)
