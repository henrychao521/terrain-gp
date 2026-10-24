"""Contact sheets of street views: python3 tools/jianzhong/contact.py <street dir> <out prefix> [per sheet] [cols] [thumb width]"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]; per = int(sys.argv[3]) if len(sys.argv) > 3 else 12; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4; tw = int(sys.argv[5]) if len(sys.argv) > 5 else 400
S = json.load(open(os.path.join(d, 'street.json')))['shots']
f = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 16)
for si in range(0, len(S), per):
    grp = S[si:si + per]; ims = [Image.open(os.path.join(d, s['file'])) for s in grp]; th = int(ims[0].height * tw / ims[0].width)
    rows = (len(grp) + cols - 1) // cols; sheet = Image.new('RGB', (cols * tw, rows * th), (0, 0, 0)); dr = ImageDraw.Draw(sheet)
    for i, (s, im) in enumerate(zip(grp, ims)):
        x, y = (i % cols) * tw, (i // cols) * th; sheet.paste(im.resize((tw, th)), (x, y))
        dr.text((x + 4, y + 2), f"k{s['k']} {s['dir']} {s['s_m']}m {s['road']}", fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0))
    sheet.save(f'{out}_{si // per:02d}.jpg', quality=85)
print('sheets', (len(S) + per - 1) // per)
