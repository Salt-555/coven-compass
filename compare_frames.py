#!/usr/bin/env python3
"""Compare keyframes to video frames to see if video is keyframes + overlay burn."""
from PIL import Image
import sys

def avg_diff(path_a, path_b):
    a = Image.open(path_a).convert('RGB').resize((176, 320))
    b = Image.open(path_b).convert('RGB').resize((176, 320))
    da, db = a.getdata(), b.getdata()
    total = 0
    n = 0
    for pa, pb in zip(da, db):
        total += abs(pa[0]-pb[0]) + abs(pa[1]-pb[1]) + abs(pa[2]-pb[2])
        n += 1
    return total / (n * 3)

pairs = [('t1', 1), ('t4', 4), ('t7', 7), ('t9', 9)]
for name, ts in pairs:
    d = avg_diff(f'ads/frames/{name}.jpg', f'/tmp/f{ts}.png')
    print(f'{name} vs video@{ts}s: mean abs diff = {d:.1f} (0=identical, <10=close, >30=different)')
