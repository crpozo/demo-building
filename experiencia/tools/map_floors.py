#!/usr/bin/env python3
"""Edita las zonas clicables de Alhelí y genera floors.js y una vista previa.
Uso: python tools/map_floors.py
"videoReverse" es el video invertido que se usa al volver; se crea con tools/make_reverse.py.
Las coordenadas usan la escala 1024 x 572; portada.jpg mide 2560 x 1430 (la misma proporción).
Requiere Pillow únicamente para generar la vista previa: pip install Pillow
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"

FLOORS = [
    {
        "id": "terraza-comunal",
        "number": "TC",
        "name": "Terraza comunal",
        "nivel": "Cubierta",
        "description": "Terraza comunal cubierta con salas lounge, comedor exterior y jardineras tropicales.",
        "points": [[440,184],[636,184],[636,219],[440,219]],
        "video": "assets/v_terraza.mp4",
        "videoReverse": "assets/v_terraza_rev.mp4",
        "image": "assets/terraza_comunal.jpg",
        "status": "available"
    },
    {
        "id": "depto-6",
        "name": "Departamento 6",
        "nivel": "Planta alta",
        "description": "Sala, comedor y cocina abiertos a una gran terraza privada en L.",
        "points": [[263,198],[427,196],[438,209],[438,276],[353,282],[264,271]],
        "video": "assets/v07_d6_sala.mp4",
        "videoReverse": "assets/v07_d6_sala_rev.mp4",
        "image": "assets/d6_sala.jpg",
        "status": "available"
    },
    {
        "id": "depto-1",
        "name": "Departamento 1",
        "nivel": "Planta baja",
        "description": "Sala abierta al comedor, patio privado y una acogedora zona de BBQ.",
        "points": [[447,294],[493,287],[538,289],[639,291],[639,366],[577,370],[512,363],[447,355]],
        "video": "assets/v01_d1_sala_fwd.mp4",
        "videoReverse": "assets/v01_d1_sala_fwd_rev.mp4",
        "image": "assets/d1_sala.jpg",
        "status": "available"
    },
    {
        "id": "depto-5",
        "name": "Departamento 5",
        "nivel": "Planta alta",
        "description": "Una nueva experiencia estará disponible muy pronto.",
        "points": [[432,222],[536,222],[542,278],[440,279]],
        "pointsLabel": [483,235],
        "video": "",
        "videoReverse": "",
        "image": "",
        "status": "soon"
    },
    {
        "id": "depto-10",
        "name": "Departamento 10",
        "nivel": "Planta alta",
        "description": "Una nueva experiencia estará disponible muy pronto.",
        "points": [[536,213],[693,217],[704,279],[550,281]],
        "video": "",
        "videoReverse": "",
        "image": "",
        "status": "soon"
    }
]


def check_assets():
    """Avisa si algún archivo referenciado no existe en assets."""
    for item in FLOORS:
        for key in ("video", "videoReverse", "image"):
            path = item.get(key)
            if path and not (ROOT / path).exists():
                print(f"Aviso: {item['id']} -> {key} no existe: {path}")


def export_javascript():
    output = "// Generado por tools/map_floors.py. No edites este archivo directamente.\n"
    output += "window.FLOORS = " + json.dumps(FLOORS, ensure_ascii=False, indent=2) + ";\n"
    (ROOT / "floors.js").write_text(output, encoding="utf-8")


def export_preview():
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("Vista previa omitida. Instala Pillow con: pip install Pillow")
        return
    image = Image.open(ASSETS / "portada.jpg").convert("RGBA").resize((1024, 572), Image.LANCZOS)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.load_default(size=18)
    for item in FLOORS:
        points = [tuple(point) for point in item["points"]]
        color = (246, 199, 119) if item["status"] == "available" else (185, 190, 200)
        draw.polygon(points, fill=(*color, 70), outline=(*color, 255), width=3)
        label = item.get("pointsLabel") or [round(sum(p[0] for p in points) / len(points)), round(sum(p[1] for p in points) / len(points))]
        x, y = label
        text = item["name"].replace("Departamento ", "D")
        box = draw.textbbox((x, y), text, font=font, anchor="mm")
        draw.rounded_rectangle((box[0]-8, box[1]-6, box[2]+8, box[3]+6), radius=7, fill=(15, 20, 26, 215))
        draw.text((x, y), text, font=font, fill=(255, 255, 255), anchor="mm")
    Image.alpha_composite(image, overlay).convert("RGB").save(ROOT / "polygon_preview.png")


if __name__ == "__main__":
    check_assets()
    export_javascript()
    export_preview()
    print("Listo: floors.js y polygon_preview.png actualizados.")
