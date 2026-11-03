# Alhelí Showroom — app de escritorio

Aplicación para Mac y Windows que muestra el mismo showroom con el modo de render de alta calidad activado por defecto (iluminación ambiental, tono cinematográfico, oclusión ambiental y bloom), usando la GPU del equipo.

## Compilar en tu Mac
```bash
cd desktop
npm install
npm run dist:mac
```
El instalador queda en `desktop/dist/Alheli-Showroom-<versión>-mac-universal.dmg`.

## Compilar desde GitHub
Crear una etiqueta `v*` (por ejemplo `v0.1.0`) y subirla: el flujo `.github/workflows/desktop.yml` compila el DMG para Mac y el instalador para Windows y los publica en la página de Releases del repositorio. También se puede lanzar a mano desde la pestaña Actions.

## Firma
El instalador de Mac sale firmado y notarizado cuando existen los secretos descritos en FIRMA.md.
