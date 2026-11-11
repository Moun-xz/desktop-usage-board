"""生成看板图标：assets/icon.png（应用图标）与 assets/tray.png（托盘图标）。

用法：
    python tools/gen-icons.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

SS = 4  # 超采样倍数，保证边缘平滑


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    """竖直方向的线性渐变"""
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(int(round(lerp(top[i], bottom[i], t))) for i in range(3))
        for x in range(size):
            px[x, y] = (*color, 255)
    return img


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def clock_hands(draw: ImageDraw.ImageDraw, center: float, radius: float, width: float, color):
    cx, cy = center, center
    # 指针：10:10 的经典角度
    for angle_deg, length in ((-125, 0.52), (-30, 0.72)):
        a = math.radians(angle_deg)
        x = cx + math.cos(a) * radius * length
        y = cy + math.sin(a) * radius * length
        draw.line((cx, cy, x, y), fill=color, width=int(round(width)), joint="curve")


def clock_glyph(size: int, ring_color, hand_color) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = size * 0.18
    box = (pad, pad, size - pad, size - pad)
    draw.ellipse(box, outline=ring_color, width=int(round(size * 0.075)))
    clock_hands(draw, size / 2, size / 2 - pad, size * 0.075, hand_color)
    return img


def make_icon(path: Path, size: int, radius_ratio: float) -> None:
    big = size * SS
    base = gradient(big, (111, 182, 255), (160, 123, 255))
    base.putalpha(rounded_mask(big, int(big * radius_ratio)))

    # 顶部高光，模拟玻璃质感
    gloss = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.ellipse(
        (-big * 0.35, -big * 0.85, big * 1.35, big * 0.55),
        fill=(255, 255, 255, 46),
    )
    gloss.putalpha(Image.composite(gloss.getchannel("A"), Image.new("L", (big, big), 0), rounded_mask(big, int(big * radius_ratio))))
    base = Image.alpha_composite(base, gloss)

    glyph = clock_glyph(big, (255, 255, 255, 236), (255, 255, 255, 244))
    base = Image.alpha_composite(base, glyph)

    base.resize((size, size), Image.LANCZOS).save(path)
    print(f"写入 {path.relative_to(ROOT)}  ({size}x{size})")


def make_tray(path: Path, size: int = 32) -> None:
    """托盘图标：透明背景 + 渐变圆 + 白色时钟，深浅任务栏都清晰"""
    big = size * SS
    circle = gradient(big, (128, 190, 255), (155, 125, 255))
    circle.putalpha(Image.new("L", (big, big), 0))
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    circle.putalpha(mask)

    glyph = clock_glyph(big, (255, 255, 255, 255), (255, 255, 255, 255))
    circle = Image.alpha_composite(circle, glyph)
    circle.resize((size, size), Image.LANCZOS).save(path)
    print(f"写入 {path.relative_to(ROOT)}  ({size}x{size})")


if __name__ == "__main__":
    ASSETS.mkdir(parents=True, exist_ok=True)
    make_icon(ASSETS / "icon.png", 256, 0.22)
    make_tray(ASSETS / "tray.png", 32)
