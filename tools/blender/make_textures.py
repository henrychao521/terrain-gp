"""Texture atlases for the Blender-built Taipei tiles (PIL, run with the system python).

  python3 tools/blender/make_textures.py <out dir>

Facades repeat per 2 bays x 2 floors (6 m x 6.4 m); the storefront band per 4 bays x 4.5 m.
"""
import random, sys, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
R = random.Random(11)
FONT = '/System/Library/Fonts/PingFang.ttc'
def tc_font(size):
    for i in range(12):  # pick the Traditional Chinese face inside the collection
        try:
            f = ImageFont.truetype(FONT, size, index=i)
            if 'TC' in ' '.join(f.getname()): return f
        except OSError: break
    return ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', size)
def noise(im, amt=10):
    px = im.load(); w, h = im.size
    for _ in range(w * h // 3):
        x, y = R.randrange(w), R.randrange(h); c = px[x, y]; d = R.randint(-amt, amt); px[x, y] = tuple(max(0, min(255, v + d)) for v in c[:3])
    return im

def mosaic_walkup(name, base, grout):
    """4-6 storey walk-up: small square wall tiles, aluminium windows with security grilles drawn behind the modelled cages."""
    W, H = 512, 546; im = Image.new('RGB', (W, H), base); d = ImageDraw.Draw(im)
    for y in range(0, H, 9):
        for x in range(0, W, 9): d.rectangle([x, y, x + 7, y + 7], fill=tuple(max(0, min(255, c + R.randint(-9, 9))) for c in base))
    for y in range(0, H, 9): d.line([0, y + 8, W, y + 8], fill=grout)
    for fy in range(2):
        for bx in range(2):
            x0, y0 = 40 + bx * 256, 70 + fy * 273; x1, y1 = x0 + 176, y0 + 130
            d.rectangle([x0 - 6, y0 - 6, x1 + 6, y1 + 6], fill=(120, 118, 112))
            glass = (60 + R.randint(0, 25), 78 + R.randint(0, 25), 92 + R.randint(0, 30)); d.rectangle([x0, y0, x1, y1], fill=glass)
            for gx in range(x0, x1, 22): d.line([gx, y0, gx, y1], fill=(170, 172, 170), width=3)  # grille bars
            d.line([(x0 + x1) // 2, y0, (x0 + x1) // 2, y1], fill=(200, 200, 196), width=4)
            if R.random() < 0.5:  # laundry / curtains
                d.rectangle([x0 + 10, y0 + 20, x0 + 60, y1 - 10], fill=(R.randint(150, 230), R.randint(120, 200), R.randint(100, 190)))
            d.line([x0 - 8, y1 + 12, x1 + 8, y1 + 12], fill=(90, 70, 50), width=5)  # stain line under the sill
    im = im.filter(ImageFilter.SMOOTH); noise(im, 6); im.save(f'{OUT}/{name}.png')

def glass_office(name):
    W, H = 512, 546; im = Image.new('RGB', (W, H), (70, 96, 118)); d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / H; d.line([0, y, W, y], fill=(int(80 + 60 * t), int(110 + 50 * t), int(135 + 45 * t)))
    for fy in range(2):
        y = fy * 273; d.rectangle([0, y + 222, W, y + 272], fill=(168, 172, 176))  # spandrel band
        for x in range(0, W, 64): d.line([x, y, x, y + 222], fill=(150, 156, 162), width=5)
        for x in range(0, W, 64):
            if R.random() < 0.3: d.rectangle([x + 6, y + 30, x + 58, y + 200], fill=(205, 205, 190))  # lit office
    noise(im, 4); im.save(f'{OUT}/{name}.png')

def concrete_old(name):
    W, H = 512, 546; im = Image.new('RGB', (W, H), (178, 172, 160)); d = ImageDraw.Draw(im)
    for _ in range(90):  # weather streaks
        x = R.randrange(W); d.line([x, R.randrange(H), x + R.randint(-3, 3), H], fill=(150, 144, 132), width=R.randint(2, 6))
    for fy in range(2):
        for bx in range(2):
            x0, y0 = 30 + bx * 256, 60 + fy * 273
            d.rectangle([x0, y0, x0 + 196, y0 + 150], fill=(52, 60, 66)); d.rectangle([x0 - 10, y0 + 150, x0 + 206, y0 + 190], fill=(196, 190, 178))  # balcony slab
            for gx in range(x0, x0 + 196, 14): d.line([gx, y0 + 150, gx, y0 + 186], fill=(90, 92, 92), width=3)
    im = im.filter(ImageFilter.SMOOTH); noise(im, 8); im.save(f'{OUT}/{name}.png')

SHOPS = ['藥局', '牙醫診所', '小吃', '便當', '早餐', '咖啡', '眼鏡', '機車行', '當舖', '補習班', '銀樓', '茶飲', '麵店', '五金行', '中醫', '書局', '水電行', '房屋仲介', '鞋店', '彩券行', '洗衣', '花店', '燒臘', '鹹酥雞']
def storefront(name):
    W, H = 1024, 384; im = Image.new('RGB', (W, H), (60, 58, 56)); d = ImageDraw.Draw(im); f = tc_font(46)
    for b in range(4):
        x0 = b * 256
        d.rectangle([x0, 0, x0 + 255, 70], fill=(R.randint(30, 220), R.randint(30, 200), R.randint(30, 200)))  # shop sign band
        t = R.choice(SHOPS); d.text((x0 + 128, 36), t, font=f, fill=(255, 255, 250) if R.random() < 0.7 else (250, 230, 40), anchor='mm')
        kind = R.random()
        if kind < 0.35:  # rolling shutter
            d.rectangle([x0 + 10, 80, x0 + 246, H], fill=(150, 152, 150))
            for y in range(80, H, 8): d.line([x0 + 10, y, x0 + 246, y], fill=(120, 122, 120), width=2)
        else:  # lit shop interior behind glass
            d.rectangle([x0 + 10, 80, x0 + 246, H], fill=(200, 196, 170))
            for _ in range(6): x = x0 + R.randint(20, 220); d.rectangle([x, R.randint(150, 300), x + R.randint(10, 30), H], fill=(R.randint(60, 200), R.randint(60, 200), R.randint(60, 200)))
            d.rectangle([x0 + 10, 80, x0 + 246, H], outline=(90, 90, 92), width=6)
        d.rectangle([x0, 0, x0 + 6, H], fill=(140, 138, 132))  # column
    noise(im, 5); im.save(f'{OUT}/{name}.png')

def signboards(name):
    """16 vertical light-box signs (直立招牌), 128 x 512 each, laid out 8 x 2."""
    W, H = 1024, 1024; im = Image.new('RGB', (W, H)); d = ImageDraw.Draw(im); f = tc_font(84)
    pal = [((200, 30, 36), (255, 245, 210)), ((250, 250, 245), (200, 20, 30)), ((20, 70, 160), (255, 255, 255)), ((250, 210, 30), (180, 20, 20)), ((20, 120, 70), (255, 255, 230)), ((255, 255, 255), (20, 60, 150))]
    words = ['藥局', '牙醫', '銀樓', '眼鏡', '當舖', '中醫', '補習班', '診所', '咖啡', '旅社', '小吃', '機車', '書局', '茶', '美髮', '麵館']
    for i, wtxt in enumerate(words):
        x0, y0 = (i % 8) * 128, (i // 8) * 512; bg, fg = pal[i % len(pal)]
        d.rectangle([x0, y0, x0 + 127, y0 + 511], fill=bg); d.rectangle([x0 + 4, y0 + 4, x0 + 123, y0 + 507], outline=fg, width=4)
        n = len(wtxt); step = min(110, 470 // max(n, 1))
        for j, ch in enumerate(wtxt): d.text((x0 + 64, y0 + 30 + step * j + step // 2), ch, font=tc_font(min(84, step - 8)), fill=fg, anchor='mm')
    im.save(f'{OUT}/{name}.png')

SIGN_WORDS = ['藥局', '牙醫診所', '小兒科', '眼科', '早餐店', '自助餐', '牛肉麵', '水餃', '便當', '咖啡', '茶飲', '烘焙坊', '眼鏡行', '鐘錶',
              '銀樓', '當舖', '五金行', '水電行', '機車行', '輪胎', '書局', '文具', '補習班', '才藝教室', '美髮', '洗衣', '花店', '房屋仲介', '彩券行',
              '中醫診所', '鹹酥雞', '滷味', '火鍋', '燒臘', '豆漿', '電器行']
def signs_h(name):
    """32 horizontal shop signs (橫式招牌) hung on the arcade fascia, 512 x 128 each, laid out 4 x 8."""
    W, H = 2048, 1024; im = Image.new('RGB', (W, H)); d = ImageDraw.Draw(im)
    pal = [((200, 30, 36), (255, 245, 210)), ((250, 250, 245), (200, 20, 30)), ((20, 70, 160), (255, 255, 255)), ((250, 210, 30), (160, 20, 20)),
           ((20, 120, 70), (255, 255, 230)), ((255, 255, 255), (20, 60, 150)), ((240, 120, 20), (255, 255, 255)), ((30, 30, 34), (250, 220, 60))]
    words = R.sample(SIGN_WORDS, 32)
    for i, wtxt in enumerate(words):
        x0, y0 = (i % 4) * 512, (i // 4) * 128; bg, fg = pal[R.randrange(len(pal))]
        d.rectangle([x0, y0, x0 + 511, y0 + 127], fill=bg); d.rectangle([x0 + 5, y0 + 5, x0 + 506, y0 + 122], outline=fg, width=4)
        size = min(92, 420 // max(len(wtxt), 2)); d.text((x0 + 256, y0 + 64), wtxt, font=tc_font(size), fill=fg, anchor='mm')
    im.save(f'{OUT}/{name}.png')

def storefront_ai(ai_dir):
    """AI shop fronts (tools/blender/ai_textures/shop_ai_*.jpg, no lettering) under a drawn shop-name band, 4 bays x 4.5 m;
    their Marigold normal maps get a flat band to match."""
    for f in sorted(os.listdir(ai_dir)):
        if not (f.startswith('shop_ai_') and f.endswith('.jpg')): continue
        name = 'storefront_ai_' + f[8:-4]; W, H, band = 1024, 384, 70
        im = Image.new('RGB', (W, H)); d = ImageDraw.Draw(im); fnt = tc_font(46)
        im.paste(Image.open(os.path.join(ai_dir, f)).convert('RGB').resize((W, H - band), Image.LANCZOS), (0, band))
        for b, word in enumerate(R.sample(SHOPS, 4)):
            x0 = b * 256; d.rectangle([x0, 0, x0 + 255, band], fill=(R.randint(30, 220), R.randint(30, 200), R.randint(30, 200)))
            d.text((x0 + 128, band // 2 + 1), word, font=fnt, fill=(255, 255, 250) if R.random() < 0.7 else (250, 230, 40), anchor='mm')
        im.save(f'{OUT}/{name}.png')
        nf = os.path.join(ai_dir, 'normals', f[:-4] + '_n.jpg')
        if os.path.exists(nf):
            nm = Image.new('RGB', (W, H), (128, 128, 255)); nm.paste(Image.open(nf).convert('RGB').resize((W, H - band), Image.LANCZOS), (0, band)); nm.save(f'{OUT}/{name}_n.png')

def roof(name):
    W = 256; im = Image.new('RGB', (W, W), (128, 126, 120)); d = ImageDraw.Draw(im)
    for _ in range(40): x, y = R.randrange(W), R.randrange(W); d.ellipse([x, y, x + R.randint(10, 60), y + R.randint(10, 60)], fill=(R.choice([95, 120, 140]), R.choice([118, 128, 140]), R.choice([96, 120, 128])))
    im = im.filter(ImageFilter.GaussianBlur(3)); noise(im, 8); im.save(f'{OUT}/{name}.png')

def glazed(name, c0, c1):
    """Glazed roof tiles: barrel rows along v, courses across u."""
    W = 256; im = Image.new('RGB', (W, W), c0); d = ImageDraw.Draw(im)
    for x in range(0, W, 16):
        for xx in range(16): t = abs(xx - 8) / 8; d.line([x + xx, 0, x + xx, W], fill=tuple(int(a + (b - a) * (1 - t)) for a, b in zip(c0, c1)))
    for y in range(0, W, 24): d.line([0, y, W, y], fill=tuple(int(v * 0.7) for v in c0), width=3)
    noise(im, 6); im.save(f'{OUT}/{name}.png')

def roof_concrete(name, base):
    """Flat concrete roof seen from above: weathered slab, expansion joints, drain stains (16 m per tile)."""
    W = 256; im = Image.new('RGB', (W, W), base); d = ImageDraw.Draw(im)
    for _ in range(60):
        x, y = R.randrange(W), R.randrange(W); k = R.randint(-18, 10); d.ellipse([x, y, x + R.randint(8, 50), y + R.randint(8, 50)], fill=tuple(max(0, min(255, c + k)) for c in base))
    im = im.filter(ImageFilter.GaussianBlur(4)); d = ImageDraw.Draw(im)
    for v in range(0, W, 64): d.line([v, 0, v, W], fill=tuple(c - 22 for c in base), width=2); d.line([0, v, W, v], fill=tuple(c - 22 for c in base), width=2)
    noise(im, 7); im.save(f'{OUT}/{name}.png')

def roof_metal(name, col):
    """Corrugated metal sheet (rooftop sheds, 鐵皮加蓋), ribs along v (8 m per tile)."""
    W = 256; im = Image.new('RGB', (W, W), col); d = ImageDraw.Draw(im)
    for x in range(0, W, 8):
        for xx in range(8): t = abs(xx - 4) / 4; d.line([x + xx, 0, x + xx, W], fill=tuple(int(c * (0.78 + 0.3 * (1 - t))) for c in col))
    for _ in range(25): x, y = R.randrange(W), R.randrange(W); d.line([x, y, x + R.randint(-4, 4), y + R.randint(20, 80)], fill=tuple(int(c * 0.7) for c in col), width=R.randint(1, 3))  # rust streaks
    for y in range(0, W, 128): d.line([0, y, W, y], fill=tuple(int(c * 0.6) for c in col), width=2)  # sheet overlap
    noise(im, 6); im.save(f'{OUT}/{name}.png')

def roof_solar(name):
    """Rows of PV panels on a flat roof (16 m per tile)."""
    W = 256; im = Image.new('RGB', (W, W), (150, 148, 142)); d = ImageDraw.Draw(im)
    for y in range(8, W, 32):
        for x in range(6, W - 20, 26):
            d.rectangle([x, y, x + 22, y + 24], fill=(38, 52, 78)); d.line([x + 11, y, x + 11, y + 24], fill=(70, 84, 110), width=1); d.line([x, y + 12, x + 22, y + 12], fill=(70, 84, 110), width=1)
    noise(im, 5); im.save(f'{OUT}/{name}.png')

mosaic_walkup('facade_mosaic_cream', (214, 204, 182), (186, 176, 156))
mosaic_walkup('facade_mosaic_pink', (204, 176, 168), (176, 150, 142))
mosaic_walkup('facade_mosaic_grey', (176, 178, 176), (150, 152, 150))
glass_office('facade_glass'); concrete_old('facade_concrete'); storefront('storefront'); signboards('signboards'); roof('roof')
signs_h('signs_h'); storefront_ai(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ai_textures'))
roof_concrete('roof_concrete_a', (156, 154, 148)); roof_concrete('roof_concrete_b', (176, 172, 162)); roof_concrete('roof_concrete_c', (128, 126, 122))
roof_metal('roof_metal_red', (150, 70, 58)); roof_metal('roof_metal_blue', (82, 110, 140)); roof_metal('roof_metal_green', (112, 150, 120)); roof_metal('roof_metal_grey', (170, 172, 170))
roof_solar('roof_solar'); glazed('tile_green', (40, 104, 92), (96, 168, 150)); glazed('tile_slate', (52, 54, 58), (92, 94, 98))
glazed('tile_blue', (28, 62, 128), (70, 120, 196)); glazed('tile_gold', (176, 120, 30), (236, 186, 70)); glazed('tile_orange', (150, 70, 30), (210, 120, 60))
print('textures in', OUT, sorted(os.listdir(OUT)))
