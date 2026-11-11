"""生成 GitHub Social Preview（1280x640）：深色渐变背景 + 看板卡片 + 标题。

用法：python tools/make-social-preview.py
输出：assets/social-preview.png
（GitHub 设置 → General → Social preview → 上传这张图）

卡片取自 assets/card-dark.png（窗口内容截图，没有壁纸背景）。
想更新卡片：先停掉看板，再跑
`node_modules\\electron\\dist\\electron.exe . --capture=assets/card-dark.png`（截图后自动退出）。
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "card-dark.png"
OUT = ROOT / "assets" / "social-preview.png"

W, H = 1280, 640
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msyh.ttc"


def card_image(height: int) -> Image.Image:
    src = Image.open(SRC).convert("RGB")
    inset = 4  # 圆角处会透出一点桌面，往里裁掉几像素
    src = src.crop((inset, inset, src.width - inset, src.height - inset))
    width = round(src.width * height / src.height)
    return src.resize((width, height), Image.LANCZOS)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def vertical_gradient(w: int, h: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    grad = Image.new("RGB", (1, h))
    for y in range(h):
        k = y / max(1, h - 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * k) for i in range(3)))
    return grad.resize((w, h))


def radial_glow(size: tuple[int, int], color: tuple[int, int, int], alpha: int) -> Image.Image:
    w, h = size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx, cy = int(w * 0.72), int(h * 0.45)
    radius = int(h * 0.9)
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(120))


def main() -> None:
    bg = vertical_gradient(W, H, (11, 15, 26), (20, 26, 44)).convert("RGBA")
    bg = Image.alpha_composite(bg, radial_glow((W, H), (94, 132, 255), 90))
    bg = Image.alpha_composite(bg, radial_glow((W, H), (255, 138, 92), 55))

    card_h = 372
    card = card_image(card_h)
    card.putalpha(rounded_mask(card.size, 16))

    # 卡片位置：右侧居中
    card_x = W - card.width - 74
    card_y = (H - card.height) // 2

    # 阴影
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (card_x - 6, card_y - 6, card_x + card.width + 6, card_y + card.height + 10),
        22,
        fill=(0, 0, 0, 170),
    )
    bg = Image.alpha_composite(bg, shadow.filter(ImageFilter.GaussianBlur(30)))
    bg.alpha_composite(card, (card_x, card_y))

    draw = ImageDraw.Draw(bg)
    title = ImageFont.truetype(FONT_BOLD, 66)
    subtitle = ImageFont.truetype(FONT_REG, 26)
    desc = ImageFont.truetype(FONT_REG, 21)
    tag = ImageFont.truetype(FONT_BOLD, 19)

    x = 76
    draw.text((x, 150), "桌面看板", font=title, fill=(255, 255, 255))
    draw.text((x, 244), "屏幕使用时间 · 透明毛玻璃", font=subtitle, fill=(223, 231, 245))
    draw.text((x, 288), "Windows 11 系统级亚克力模糊", font=desc, fill=(157, 172, 196))
    draw.text((x, 316), "参考 macOS 桌面小组件形态", font=desc, fill=(157, 172, 196))

    tags = ["Electron", "Windows 11", "Acrylic", "MIT License"]
    tx, ty = x, 380
    for text in tags:
        box_w = draw.textlength(text, font=tag) + 30
        draw.rounded_rectangle(
            (tx, ty, tx + box_w, ty + 38), 19, fill=(255, 255, 255, 22), outline=(255, 255, 255, 60)
        )
        draw.text((tx + 15, ty + 9), text, font=tag, fill=(206, 218, 238))
        tx += box_w + 10

    draw.text((x, 462), "今天用了多久电脑，一眼就知道。", font=desc, fill=(136, 150, 172))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"saved {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
