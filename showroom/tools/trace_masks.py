#!/usr/bin/env python3
"""Convierte las máscaras de la vista aérea (../material/render_aereo/mask-<i>.png) en contornos por departamento.

Cada departamento está pintado en la máscara con emisión roja lineal n/10 (n = 1..10), guardada en sRGB. Para cada vista se
buscan las zonas visibles de cada departamento, se traza su borde y se simplifica. Salida:
tools/aerial_units.json  ->  { "0": { "units": { "7": [[[x%, y%], ...], ...] }, "labels": { "7": [x%, y%] } }, ... }
La etiqueta va en el punto más interior de la zona visible más grande (no en el centroide, que en
las formas en L puede caer afuera).
Uso: python tools/trace_masks.py
"""
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
AERIAL = ROOT.parent / 'material' / 'render_aereo'
W, H = 640, 360           # resolución de trabajo
MIN_AREA = 90             # píxeles (a 640x360) para considerar una zona
EPS = 1.2                 # tolerancia de simplificación en píxeles


def components(mask):
    """Componentes conexas (4-vecinos) de una máscara booleana."""
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        pix = []
        while q:
            y, x = q.popleft()
            pix.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        comps.append(pix)
    return comps


def trace(comp):
    """Borde exterior de una componente (seguimiento de Moore, sentido horario)."""
    m = np.zeros((H + 2, W + 2), dtype=bool)
    for y, x in comp:
        m[y + 1, x + 1] = True
    n8 = [(-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1)]
    sy, sx = min(comp)
    s = (sy + 1, sx + 1)
    back = (s[0], s[1] - 1)          # el vecino del oeste siempre está afuera
    c = s
    path = [c]
    for _ in range(len(comp) * 4 + 16):
        k = n8.index((back[0] - c[0], back[1] - c[1]))
        nxt = None
        for i in range(1, 9):
            j = (k + i) % 8
            q = (c[0] + n8[j][0], c[1] + n8[j][1])
            if m[q]:
                pj = (j - 1) % 8
                nxt, back = q, (c[0] + n8[pj][0], c[1] + n8[pj][1])
                break
        if nxt is None or nxt == s:
            break
        c = nxt
        path.append(c)
    return [(x - 1 + 0.5, y - 1 + 0.5) for y, x in path]


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    n = np.linalg.norm(ab)
    best, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i])
        d = p - a
        dist = abs(ab[0] * d[1] - ab[1] * d[0]) / n if n else np.linalg.norm(d)
        if dist > best:
            best, idx = dist, i
    if best > eps:
        return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def simplify_closed(pts):
    # se parte el anillo en dos mitades para que RDP funcione con un contorno cerrado
    h = len(pts) // 2
    return rdp(pts[:h + 1], EPS)[:-1] + rdp(pts[h:] + [pts[0]], EPS)[:-1]


def inner_point(comp):
    """Píxel más alejado del borde: se erosiona la zona hasta que casi desaparece."""
    m = np.zeros((H, W), dtype=bool)
    for y, x in comp:
        m[y, x] = True
    last = m
    while m.any():
        last = m
        e = m.copy()
        e[1:, :] &= m[:-1, :]
        e[:-1, :] &= m[1:, :]
        e[:, 1:] &= m[:, :-1]
        e[:, :-1] &= m[:, 1:]
        m = e
    ys, xs = np.nonzero(last)
    cy, cx = ys.mean(), xs.mean()
    i = int(np.argmin((ys - cy) ** 2 + (xs - cx) ** 2))
    return [round((xs[i] + 0.5) / W * 100, 2), round((ys[i] + 0.5) / H * 100, 2)]


def main():
    out = {}
    for f in sorted(AERIAL.glob('mask-*.png')):
        view = f.stem.split('-')[1]
        red = np.asarray(Image.open(f).convert('RGB').resize((W, H), Image.NEAREST))[:, :, 0].astype(int)
        units, labels = {}, {}
        for n in range(1, 11):
            v = n / 10.0  # Blender guarda la emisión lineal n/10 codificada en sRGB
            target = round(255 * (1.055 * v ** (1 / 2.4) - 0.055 if v > 0.0031308 else 12.92 * v))
            mask = np.abs(red - target) <= 6
            polys = []
            comps = sorted(components(mask), key=len, reverse=True)
            if comps and len(comps[0]) >= MIN_AREA:
                labels[str(n)] = inner_point(comps[0])
            for comp in comps:
                if len(comp) < MIN_AREA:
                    continue
                ring = simplify_closed(trace(comp))
                if len(ring) >= 3:
                    polys.append([[round(x / W * 100, 2), round(y / H * 100, 2)] for x, y in ring])
            if polys:
                units[str(n)] = polys
        out[view] = {'units': units, 'labels': labels}
        print('vista', view, {k: len(v) for k, v in units.items()})
    (ROOT / 'tools' / 'aerial_units.json').write_text(json.dumps(out), encoding='utf-8')


if __name__ == '__main__':
    main()
