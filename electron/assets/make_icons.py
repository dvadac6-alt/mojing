"""生成墨境的应用图标与托盘图标（依赖 Pillow，venv 内已装）。

设计语言（对齐设计师交付稿）：
  黑色玻璃质感超椭圆底 + 白色水墨笔刷圆环 + 朱砂红印章 + 白色楷体「墨」。

两部分来源：
  - 水墨圆环：程序化绘制的 enso 笔刷环（变宽度笔锋 + 枯笔噪点 + 底部
    留缺口），4x 超采样后缩小，各尺寸下形态稳定；
  - 其余元素（底、印章、字体）：本脚本绘制。

产物：
  electron/assets/tray-icon.png     32x32  托盘图标
  electron/assets/tray-icon@2x.png  64x64  高分屏托盘图标（Electron 自动识别）
  build/icon.ico                    16/32/48/256  应用图标（electron-builder 默认拾取）

改动设计后重跑：.venv\\Scripts\\python.exe electron/assets/make_icons.py
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
ASSETS = os.path.join(ROOT, 'electron', 'assets')

SEAL_RED = (195, 58, 36)        # 朱砂红（设计稿取样 204,60,36 微调）
SEAL_BORDER = (126, 33, 19)
PAPER = (245, 242, 235)         # 纸白（环与字）

MASTER = 256


def superellipse_mask(size, n=4.0):
    """玻璃质感图标的圆角方（超椭圆）alpha 掩码。"""
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    c = size / 2
    r = size / 2 - 1
    steps = 720
    pts = []
    for i in range(steps):
        t = 2 * 3.141592653589793 * i / steps
        ct, st = pow(abs(__import__('math').cos(t)), 2 / n), pow(abs(__import__('math').sin(t)), 2 / n)
        pts.append((c + r * __import__('math').copysign(ct, __import__('math').cos(t)),
                    c + r * __import__('math').copysign(st, __import__('math').sin(t))))
    d.polygon(pts, fill=255)
    return m


def enso_ring(size):
    """水墨 enso 圈：L 掩码。变宽度笔锋（起笔重、收笔细）、沿程半径抖动、
    枯笔噪点、底部留缺口。在 4x 分辨率绘制再由调用方缩小。"""
    import math
    import random
    S = size * 4
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    random.seed(11)
    cx = cy = S / 2
    R = S * 0.395
    gap = math.radians(64)          # 底部缺口张角
    start = math.pi / 2 + gap / 2   # 从缺口右端起笔，顺时针画一整圈
    steps = 560
    for i in range(steps):
        t = i / (steps - 1)
        ang = start + t * (2 * math.pi - gap)
        # 宽度包络：起笔 1.0 → 20% 处最粗 1.25 → 收笔渐细至 0.22
        swell = 1.0 + 0.25 * math.sin(min(t / 0.2, 1) * math.pi / 2)
        taper = 1.0 - 0.78 * (max(0, (t - 0.35) / 0.65)) ** 1.4
        w = S * 0.040 * swell * taper
        wob = R + math.sin(ang * 3 + 1.2) * S * 0.004 + random.uniform(-S * 0.0015, S * 0.0015)
        x, y = cx + math.cos(ang) * wob, cy + math.sin(ang) * wob
        # 枯笔：笔宽带内随机留白小孔
        d.ellipse([x - w, y - w, x + w, y + w], fill=255)
    for _ in range(int(S * S / 900)):  # 枯笔打孔
        ang = start + random.random() * (2 * math.pi - gap)
        rr = R + random.uniform(-S * 0.03, S * 0.03)
        x, y = cx + math.cos(ang) * rr, cy + math.sin(ang) * rr
        r = random.uniform(S * 0.004, S * 0.012)
        d.ellipse([x - r, y - r, x + r, y + r], fill=0)
    return m.filter(ImageFilter.GaussianBlur(3)).resize((size, size), Image.LANCZOS)


def build_master():
    canvas = Image.new('RGBA', (MASTER, MASTER), (0, 0, 0, 0))

    # ── 玻璃底：上亮下暗的纵向渐变 + 发丝亮边 ──
    base = Image.new('RGBA', (MASTER, MASTER), (0, 0, 0, 0))
    top, bottom = (30, 30, 33, 255), (11, 11, 13, 255)
    for y in range(MASTER):
        k = y / (MASTER - 1)
        row = tuple(round(a + (b - a) * k) for a, b in zip(top, bottom))
        ImageDraw.Draw(base).line([(0, y), (MASTER, y)], fill=row)
    mask = superellipse_mask(MASTER)
    canvas.alpha_composite(Image.composite(base, Image.new('RGBA', base.size, (0, 0, 0, 0)), mask))
    edge = mask.filter(ImageFilter.GaussianBlur(0.6))
    hair = Image.new('RGBA', (MASTER, MASTER), (255, 255, 255, 30))
    canvas.alpha_composite(Image.composite(hair, Image.new('RGBA', hair.size, (0, 0, 0, 0)),
                                           edge.point(lambda v: 255 if v > 234 else 0)))

    # ── 水墨 enso 圈：纸白笔刷环，居中衬在印章后 ──
    ring_d = 206
    ring_alpha = enso_ring(ring_d)
    tinted = Image.new('RGBA', (ring_d, ring_d), PAPER + (255,))
    canvas.alpha_composite(Image.composite(tinted, Image.new('RGBA', tinted.size, (0, 0, 0, 0)), ring_alpha),
                           ((MASTER - ring_d) // 2, (MASTER - ring_d) // 2))

    # ── 朱砂印章：圆角方 + 深色描边 ──
    seal_box = 118
    sx = (MASTER - seal_box) // 2
    seal = Image.new('RGBA', (seal_box * 4, seal_box * 4), (0, 0, 0, 0))
    sd = ImageDraw.Draw(seal)
    pad = 8
    radius = int(seal_box * 4 * 0.16)
    sd.rounded_rectangle([pad * 4, pad * 4, seal_box * 4 - pad * 4, seal_box * 4 - pad * 4],
                         radius=radius, fill=SEAL_RED + (255,), outline=SEAL_BORDER + (255,), width=8)
    # 印面做一点斑驳感：细小的透明噪点
    noise = ImageDraw.Draw(seal)
    import random
    random.seed(7)
    for _ in range(260):
        x = random.randint(pad * 4, seal_box * 4 - pad * 4)
        y = random.randint(pad * 4, seal_box * 4 - pad * 4)
        r = random.randint(2, 5)
        noise.ellipse([x - r, y - r, x + r, y + r], fill=(0, 0, 0, 0))
    seal = seal.resize((seal_box, seal_box), Image.LANCZOS)

    # ── 白色楷体「墨」：4x 渲染再缩小，笔画干净 ──
    glyph_size = int(seal_box * 0.74)
    layer = Image.new('L', (glyph_size * 4, glyph_size * 4), 0)
    for candidate in ('C:/Windows/Fonts/simkai.ttf', 'C:/Windows/Fonts/STKAITI.TTF', 'C:/Windows/Fonts/simhei.ttf'):
        if os.path.exists(candidate):
            font = ImageFont.truetype(candidate, glyph_size * 4)
            break
    gd = ImageDraw.Draw(layer)
    bbox = gd.textbbox((0, 0), '墨', font=font)
    gd.text((-bbox[0] + (glyph_size * 4 - (bbox[2] - bbox[0])) // 2,
             -bbox[1] + (glyph_size * 4 - (bbox[3] - bbox[1])) // 2), '墨', font=font, fill=255)
    glyph = layer.resize((glyph_size, glyph_size), Image.LANCZOS)
    seal.paste(Image.new('RGBA', (glyph_size, glyph_size), PAPER + (255,)),
               ((seal_box - glyph_size) // 2, (seal_box - glyph_size) // 2), glyph)
    canvas.alpha_composite(seal, (sx, (MASTER - seal_box) // 2))
    return canvas


def write_png(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=True)
    print(f'wrote {os.path.relpath(path, ROOT)} ({img.width}x{img.height})')


if __name__ == '__main__':
    master = build_master()
    write_png(master.resize((32, 32), Image.LANCZOS), os.path.join(ASSETS, 'tray-icon.png'))
    write_png(master.resize((64, 64), Image.LANCZOS), os.path.join(ASSETS, 'tray-icon@2x.png'))
    ico_path = os.path.join(ROOT, 'build', 'icon.ico')
    os.makedirs(os.path.dirname(ico_path), exist_ok=True)
    master.resize((256, 256), Image.LANCZOS).save(
        ico_path, format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
    print(f'wrote {os.path.relpath(ico_path, ROOT)} (16/32/48/256)')
