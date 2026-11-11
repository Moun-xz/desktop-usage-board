"""
把 tools/record-demo.js 拍下的逐帧 PNG 合成一张 GIF（用于 README 首屏）。

用法：
    python tools/make-demo-gif.py <帧目录> <输出.gif> [裁剪框] [宽] [颜色数] [起始帧] [结束帧]

例：
    python tools/make-demo-gif.py %TEMP%\\demo-frames assets/demo.gif "6,73,829,609" 700 96

说明：
    - 帧是按物理像素拍的（dpr=1.5），裁剪框也用物理像素。
    - 首帧会多停 0.3 秒，让读者先看清界面再进入动作。
    - GIF 有 256 色上限，这里用自适应调色板 + 逐帧局部调色；有 ffmpeg 的话可以换掉这一步。
"""
import glob
import os
import sys

from PIL import Image

frames_dir = sys.argv[1]
out_path = sys.argv[2]
crop_arg = sys.argv[3] if len(sys.argv) > 3 else ""
target_w = int(sys.argv[4]) if len(sys.argv) > 4 else 700
colors = int(sys.argv[5]) if len(sys.argv) > 5 else 96
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
    ratio = target_w / im.width
    if ratio != 1:
        im = im.resize((target_w, max(1, round(im.height * ratio))), Image.LANCZOS)
    images.append(im.convert("P", palette=Image.ADAPTIVE, colors=colors))

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
