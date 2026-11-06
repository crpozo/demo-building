#!/usr/bin/env python3
"""Genera la versión invertida de cada video de assets para el regreso a la portada.

Uso:
    python tools/make_reverse.py            # crea solo los que faltan o están desactualizados
    python tools/make_reverse.py --force    # vuelve a generarlos todos
    python tools/make_reverse.py --crf 22   # calidad (menor número, mejor calidad y más peso)

Por cada assets/nombre.mp4 crea assets/nombre_rev.mp4 con el filtro reverse de ffmpeg,
sin audio, en H.264 con yuv420p y faststart para que el navegador lo reproduzca de inmediato.
Los cuadros clave se colocan cada medio segundo para que el salto a cualquier punto sea rápido.

Requiere ffmpeg instalado y disponible en el PATH (https://ffmpeg.org).
Nota: el filtro reverse guarda todo el video en memoria. Para clips de unos 8 segundos
en 1080p necesita alrededor de 600 MB de RAM.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SUFFIX = "_rev"


def reverse_name(source: Path) -> Path:
    return source.with_name(f"{source.stem}{SUFFIX}{source.suffix}")


def needs_update(source: Path, target: Path) -> bool:
    return not target.exists() or target.stat().st_mtime < source.stat().st_mtime


def build_reverse(ffmpeg: str, source: Path, target: Path, crf: int) -> bool:
    temporary = target.with_name(f"{target.stem}.tmp{target.suffix}")
    command = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(source),
        "-vf", "reverse",
        "-an",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        "-g", "12", "-keyint_min", "12", "-sc_threshold", "0",
        "-movflags", "+faststart",
        str(temporary),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        temporary.unlink(missing_ok=True)
        print(f"  Error con {source.name}:\n{result.stderr.strip()}")
        return False
    temporary.replace(target)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Crea los videos invertidos (_rev.mp4) de la carpeta assets.")
    parser.add_argument("--force", action="store_true", help="regenera aunque el archivo ya exista")
    parser.add_argument("--crf", type=int, default=20, help="calidad H.264, de 18 a 28 (por defecto 20)")
    args = parser.parse_args()

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("No se encontró ffmpeg. Instálalo y asegúrate de que esté en el PATH.")
        print("En Windows puedes usar: winget install Gyan.FFmpeg")
        return 1

    sources = sorted(
        path for path in ASSETS.glob("*.mp4")
        if not path.stem.endswith(SUFFIX) and ".tmp" not in path.stem
    )
    if not sources:
        print(f"No hay videos .mp4 en {ASSETS}")
        return 0

    created, skipped, failed = 0, 0, 0
    for source in sources:
        target = reverse_name(source)
        if not args.force and not needs_update(source, target):
            print(f"Omitido (ya existe): {target.name}")
            skipped += 1
            continue
        print(f"Invirtiendo {source.name} -> {target.name} ...")
        if build_reverse(ffmpeg, source, target, args.crf):
            created += 1
        else:
            failed += 1

    print(f"Listo. Creados: {created}. Omitidos: {skipped}. Con error: {failed}.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
