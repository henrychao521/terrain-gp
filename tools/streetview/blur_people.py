"""Blur faces, people and licence-plate-like text in street photos before they go into a report (macOS Vision, offline).

  venv/bin/python tools/streetview/blur_people.py <in.jpg> <out.jpg> [--credit "text"]

Vision requests: face rectangles, human rectangles (whole body), recognised text boxes (licence plates; shop signs get
blurred too, which is acceptable for a report). Each box is padded 20 % and Gaussian-blurred hard. An optional credit
line is drawn on a dark band at the bottom. Prints the number of boxes blurred.
"""
import argparse
import Quartz, Vision
from Foundation import NSURL
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ap = argparse.ArgumentParser(); ap.add_argument('inp'); ap.add_argument('out'); ap.add_argument('--credit', default=''); a = ap.parse_args()
url = NSURL.fileURLWithPath_(a.inp)
handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, None)
hum = Vision.VNDetectHumanRectanglesRequest.alloc().init(); hum.setUpperBodyOnly_(False)  # whole bodies, not just torsos
txt = Vision.VNRecognizeTextRequest.alloc().init(); txt.setRecognitionLevel_(1)  # fast: boxes of any text, plates included
reqs = [Vision.VNDetectFaceRectanglesRequest.alloc().init(), hum, txt]
ok, err = handler.performRequests_error_(reqs, None)
im = Image.open(a.inp).convert('RGB'); W, H = im.size; n = 0
for r in reqs:
    for o in (r.results() or []):
        bb = o.boundingBox(); x, y, w, h = bb.origin.x, bb.origin.y, bb.size.width, bb.size.height  # normalised, origin bottom-left
        px, py = w * 0.2, h * 0.2
        box = (max(0, int((x - px) * W)), max(0, int((1 - y - h - py) * H)), min(W, int((x + w + px) * W)), min(H, int((1 - y + py) * H)))
        if box[2] - box[0] < 2 or box[3] - box[1] < 2: continue
        reg = im.crop(box).filter(ImageFilter.GaussianBlur(max(6, (box[3] - box[1]) // 4))); im.paste(reg, box); n += 1
if a.credit:
    d = ImageDraw.Draw(im); fh = max(14, H // 34)
    try: font = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', fh)
    except Exception: font = ImageFont.load_default()
    d.rectangle((0, H - fh - 10, W, H), fill=(0, 0, 0)); d.text((8, H - fh - 6), a.credit, fill=(255, 255, 255), font=font)
im.save(a.out, quality=88); print('blurred', n)
