# Alhelí Residencias — showroom interactivo

Herramienta de venta para que el constructor muestre al cliente el proyecto Alhelí y navegue sus opciones.

- `index.html` — versión independiente (abrir en cualquier navegador o servir con GitHub Pages).
- `app.html` — la misma página en el formato que usa el Artifact de Claude.
- `img/` — renders, plantas y planos de cada departamento, extraídos del brochure ALHELI_SEP_2026.

## Funciones
- Recorrido visual por fachada, accesos, patio central, interiores y terraza comunal.
- Plantas baja, alta y terraza con cada departamento clicable sobre el plano.
- Fichas de los 10 departamentos con ambientes, áreas y filtros por dormitorios, planta y disponibilidad.
- Vista 3D del edificio: interiores modelados en Blender desde los planos (`blender/build_alheli.py` genera `models/*.glb`), fachadas, jardines y patio central con celosía, cuencos de agua y flores, isométrica o perspectiva, selector de piso, disponibilidad, modo "separar plantas", día/noche, pantalla completa y recorrido en primera persona con entrada a cada departamento.
