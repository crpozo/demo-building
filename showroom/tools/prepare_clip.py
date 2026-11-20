#!/usr/bin/env python3
"""Prepara un clip de transición para la web: comprime y genera la versión de vuelta.

Uso:
  python tools/prepare_clip.py ORIGEN.mp4 t_fachada_acceso
Crea en assets/video/:
  t_fachada_acceso.mp4 / t_fachada_acceso_rev.mp4         1920 px (escritorio)
  t_fachada_acceso-sm.mp4 / t_fachada_acceso_rev-sm.mp4   1280 px (celular)
Requiere ffmpeg en el PATH.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "video"

# (ancho, kbps objetivo, sufijo). Dos pasadas a tasa fija: peso predecible aunque haya mucho follaje.
SIZES = [(1920, 4200, ""), (1280, 2200, "-sm")]


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def encode(src, dst, width, kbps, reverse=False):
    vf = f"scale={width}:-2:flags=lanczos,format=yuv420p" + (",reverse" if reverse else "")
    common = ["-i", str(src), "-an", "-vf", vf, "-c:v", "libx264", "-preset", "slow",
              "-b:v", f"{kbps}k", "-maxrate", f"{int(kbps * 1.5)}k", "-bufsize", f"{kbps * 2}k",
              "-profile:v", "high", "-g", "48", "-passlogfile", str(dst.with_suffix(""))]
    ffmpeg(*common, "-pass", "1", "-f", "mp4", "NUL" if sys.platform == "win32" else "/dev/null")
    ffmpeg(*common, "-pass", "2", "-movflags", "+faststart", str(dst))
    for log in dst.parent.glob(dst.stem + "*.log*"):
        log.unlink()


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, name = Path(sys.argv[1]), sys.argv[2]
    OUT.mkdir(parents=True, exist_ok=True)
    for width, kbps, suf in SIZES:
        for rev in (False, True):
            dst = OUT / f"{name}{'_rev' if rev else ''}{suf}.mp4"
            encode(src, dst, width, kbps, reverse=rev)
            print(f"{dst.relative_to(ROOT)}  {dst.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
