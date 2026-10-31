# Alhelí Residencias — showroom interactivo

Herramienta de venta para que el constructor muestre al cliente el proyecto Alhelí y navegue sus opciones.

- `index.html` — versión independiente (abrir en cualquier navegador o servir con GitHub Pages).
- `app.html` — la misma página en el formato que usa el Artifact de Claude.
- `img/` — renders, plantas y planos de cada departamento, extraídos del brochure ALHELI_SEP_2026.

## Funciones
- Recorrido visual por fachada, accesos, patio central, interiores y terraza comunal.
- Plantas baja, alta y terraza con cada departamento clicable sobre el plano.
- Fichas de los 10 departamentos con ambientes, áreas y filtros por dormitorios, planta y disponibilidad.
- Vista 3D a pantalla completa bajo el menú: interiores modelados en Blender desde los planos (`blender/build_alheli.py` genera `models/*`), fachadas, jardines y patio central, isométrica o perspectiva, selector de piso, "Abrir paredes" para ver los interiores, disponibilidad, "Separar plantas", día/noche y pantalla completa.

## App de escritorio
En `desktop/` hay una app Electron para Mac y Windows que abre el showroom con el modo de calidad alta activado. Ver `desktop/README.md`. El flujo `.github/workflows/desktop.yml` compila los instaladores al publicar una etiqueta `v*` y los deja en Releases; la portada enlaza a la última versión.
