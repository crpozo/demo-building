/* Alhelí — recorrido libre en 3D por dentro de un departamento.
   Carga models/d<N>.glb (iluminación horneada, sin luz dinámica) y deja caminar a 1,55 m con colisión contra el
   polígono de models/d<N>_nav.json. Reutiliza el panel claro del visor de interiores (clases .intr-*) con el
   minimapa «En el plano» en vivo. Se engancha a AlheliInteriores: «Ver interior» de las unidades de RECORRIDOS abre
   esto; las demás siguen con su visor. Si no hay WebGL o el equipo es débil, muestra las panorámicas pano_<ambiente>.webp.
   Para sumar un departamento: agregar su entrada a RECORRIDOS con su GLB, su nav y la escala de su plano. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* Por unidad: planta, tamaño del jpg del plano y cómo pasar de metros del modelo a px del jpg (px = x0 + m * k),
   y si ya tiene panorámicas de respaldo. Los archivos salen del número: models/d<N>.glb, d<N>_m.glb, d<N>_nav.json,
   img/pisos/u<N>.jpg, img/interiores/d<N>/pano_<ambiente>.webp.  PUBLICADOS = unidades cuyo GLB ya está subido. */
const PUBLICADOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const PLANOS = {
  1: ['pb', 920, 608, 33, 31, 50], 2: ['pb', 712, 670, 34, 31, 50], 3: ['pb', 904, 608, 33, 31, 50], 4: ['pb', 923, 670, 29, 31, 50],
  5: ['pa', 647, 671, 31, 32, 42.86], 6: ['pa', 712, 671, 116, 32, 42.86], 7: ['pa', 815, 552, 35, 31, 50], 8: ['pa', 931, 616, 33, 31, 50],
  9: ['pa', 931, 670, 29, 31, 40.65], 10: ['pa', 912, 552, 33, 31, 40.65]
};
const CON_PANOS = [1, 2, 3];
/* Fondo detrás de los vidrios: una panorámica por nivel (Poly Haven, CC0; ver PROGRESO.md). FONDO_VERDE = columna (0–1) de la
   panorámica que debe quedar de frente; VENTANAL = hacia dónde dan los ventanales principales de la sala, en ejes del plano (x, y). */
const FONDO_VERDE = { pb: 0.38, pa: 0.38 };
const BRUMA = { pb: 0x626c3e, pa: 0x626c3e };          // color hacia el que se funde el césped lejano (el del horizonte de cada panorámica)
const VENTANAL = { 1: [1, 0], 2: [0, -1], 3: [0, -1], 4: [0, -1], 5: [1, 0], 6: [-1, 0], 7: [-1, 0], 8: [0, -1], 9: [0, 1], 10: [0, 1] };
const ENTORNO_RESPALDO = ['models/entorno.webp', 'models/entorno_m.webp'];
const NOMBRES = { sala: 'Sala', comedor: 'Comedor', cocina: 'Cocina', sala_de_estar: 'Sala de estar', dormitorio_master: 'Dormitorio máster',
  dormitorio_1: 'Dormitorio 1', dormitorio_2: 'Dormitorio 2' };
const RECORRIDOS = {};
PUBLICADOS.forEach(n => { const p = PLANOS[n]; RECORRIDOS[n] = {
  piso: p[0] === 'pb' ? 'Planta baja' : 'Planta alta',
  glb: `models/d${n}.glb`, glbMovil: `models/d${n}_m.glb`, nav: `models/d${n}_nav.json`,
  n, nivel: p[0], entorno: `models/entorno_${p[0]}.webp`, entornoMovil: `models/entorno_${p[0]}_m.webp`,
  giroFondo: 2 * Math.PI * (FONDO_VERDE[p[0]] - 0.5) - Math.atan2(VENTANAL[n][1], VENTANAL[n][0]),
  plano: { src: `img/pisos/u${n}.jpg`, w: p[1], h: p[2], x0: p[3], y0: p[4], k: p[5] },
  panos: CON_PANOS.includes(n) ? `img/interiores/d${n}/pano_` : null, nombres: NOMBRES }; });

const ALTURA = 1.55, VEL = 1.9, PITCH_MAX = THREE.MathUtils.degToRad(60), FOV0 = 62, FOV_MIN = 50, FOV_MAX = 75;
const has = n => Object.prototype.hasOwnProperty.call(RECORRIDOS, String(n));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const roomFor = (n, name) => { if (!has(n)) return null; const m = RECORRIDOS[n].nombres, w = norm(name); return Object.keys(m).find(k => norm(m[k]) === w) || null; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mq = q => !!(window.matchMedia && window.matchMedia(q).matches);
const esMovil = () => mq('(pointer:coarse)') || window.innerWidth <= 820;
const params = new URLSearchParams(location.search);
const ARROW = d => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

let previo = null;                   // API original del visor de fotos (AlheliInteriores), antes del enganche
let ui = null, gl = null;            // nodos del visor · estado WebGL (renderer, escena, cámara)
const cache = {};                    // por unidad: { nav, scene }
const st = { open: false, n: null, cfg: null, nav: null, modo: null, yaw: 0, pitch: 0, x: 0, z: 0, fov: FOV0,
  keys: {}, joy: [0, 0], goal: null, fly: null, raf: 0, last: 0, room: null, prevHash: null, focus: null, token: 0, pano: null };

/* ---------- geometría del piso caminable ---------- */
function enAnillo(r, x, z) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const caminable = (x, z) => { const c = st.nav.caminable; return enAnillo(c.exterior, x, z) && !c.huecos.some(h => enAnillo(h, x, z)); };
/* mueve con colisión: si el paso entero no entra, desliza por el eje que sí */
function mover(dx, dz) {
  if (caminable(st.x + dx, st.z + dz)) { st.x += dx; st.z += dz; return true; }
  if (dx && caminable(st.x + dx, st.z)) { st.x += dx; return true; }
  if (dz && caminable(st.x, st.z + dz)) { st.z += dz; return true; }
  return false;
}
function ambienteCerca() {
  let best = null, bd = 1e9;
  st.nav.puntos.forEach(p => { const d = Math.hypot(p.pos[0] - st.x, p.pos[2] - st.z); if (d < bd) { bd = d; best = p; } });
  return best;
}

/* ---------- DOM ---------- */
function build() {
  const root = document.createElement('div');
  root.className = 'intr rec';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.hidden = true;
  root.innerHTML =
    '<div class="intr-stage rec-stage">' +
      '<canvas class="rec-canvas"></canvas>' +
      '<div class="rec-pano" hidden></div>' +
      '<span class="intr-tag">Imagen ilustrativa</span>' +
      '<div class="rec-tip" aria-hidden="true"></div>' +
      '<div class="rec-joy" aria-hidden="true"><i></i></div>' +
      '<div class="rec-load"><div><p class="eyebrow rec-load-t">Cargando el departamento</p><div class="rec-bar"><i></i></div><p class="rec-pct">0 %</p></div></div>' +
    '</div>' +
    '<button class="menu-btn intr-x" type="button" aria-label="Cerrar el recorrido">' + ARROW('M6 6l12 12M18 6 6 18') + '</button>' +
    '<aside class="intr-panel">' +
      '<div class="intr-bar"><i class="intr-grab" aria-hidden="true"></i>' +
        '<div class="intr-title" aria-live="polite"><p class="eyebrow intr-unit"></p><h2 class="intr-room"></h2></div>' +
        '<span class="intr-count"></span>' +
        '<button class="intr-fold" type="button" aria-expanded="true" aria-label="Contraer el panel">' + ARROW('M6 9.5l6 6 6-6') + '</button></div>' +
      '<div class="intr-body">' +
        '<div class="intr-map"><p class="eyebrow">En el plano</p><div class="intr-plan rec-plan"><img alt="" draggable="false"><i class="rec-yo" aria-hidden="true"></i></div></div>' +
        '<div class="rec-estilos"><p class="eyebrow">Estilo</p><div class="rec-est" role="group" aria-label="Estilo de decoración">' +
          Object.keys(ESTILOS).map(k => '<button type="button" data-estilo="' + k + '"><i style="background:' + ESTILOS[k].muestra + '"></i>' + ESTILOS[k].t + '</button>').join('') + '</div></div>' +
        '<div class="intr-rooms"><p class="eyebrow">Ambientes</p><div class="intr-thumbs" role="group" aria-label="Ambientes"></div></div>' +
      '</div>' +
      '<div class="intr-foot"><button class="btn gold" type="button" data-asesor>Hablar con un asesor</button>' +
        '<p class="intr-hint rec-hint"></p></div>' +
    '</aside>';
  document.body.appendChild(root);
  const q = s => root.querySelector(s);
  ui = { root, stage: q('.rec-stage'), canvas: q('.rec-canvas'), pano: q('.rec-pano'), load: q('.rec-load'), bar: q('.rec-bar i'), pct: q('.rec-pct'), loadT: q('.rec-load-t'),
    tip: q('.rec-tip'), joy: q('.rec-joy'), knob: q('.rec-joy i'), unit: q('.intr-unit'), room: q('.intr-room'), count: q('.intr-count'), x: q('.intr-x'),
    fold: q('.intr-fold'), bar2: q('.intr-bar'), plan: q('.rec-plan'), planImg: q('.rec-plan img'), yo: q('.rec-yo'), thumbs: q('.intr-thumbs'), hint: q('.rec-hint') };

  ui.x.addEventListener('click', () => close());
  ui.fold.addEventListener('click', () => { const f = root.classList.toggle('is-folded'); ui.fold.setAttribute('aria-expanded', String(!f)); onResize(); });
  root.addEventListener('click', e => {
    if (e.target.closest('[data-asesor]')) { close(); return; }              // el sitio abre su formulario
    const es = e.target.closest('[data-estilo]'); if (es) { estilo = es.getAttribute('data-estilo'); aplicarEstilo(); return; }
    const b = e.target.closest('[data-room]'); if (b) irA(b.getAttribute('data-room'));
  });
  /* clic en el plano: la cámara va a ese punto si es caminable */
  ui.plan.addEventListener('click', e => {
    if (st.modo !== '3d') return;
    const r = ui.planImg.getBoundingClientRect(), p = st.cfg.plano;
    const x = ((e.clientX - r.left) / r.width * p.w - p.x0) / p.k, z = ((e.clientY - r.top) / r.height * p.h - p.y0) / p.k;
    if (caminable(x, z)) volar(x, z);
  });
  bindStage();
  bindJoy();
}

/* ---------- entrada: mirar, caminar, clic en el piso ---------- */
function bindStage() {
  const el = ui.stage; const pts = {}; let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.rec-joy') || e.target.closest('.rec-load')) return;
    pts[e.pointerId] = 1; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: e.timeStamp, moved: 0 };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* sin captura igual funciona */ }
    ui.tip.classList.add('is-off');
  });
  el.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (st.modo === 'pano') { st.pano.off -= dx; st.pano.v = Math.max(-1, Math.min(1, st.pano.v - dy / 300)); panoApply(); return; }
    const k = 0.0042 * (st.fov / FOV0);                                     // arrastrar gira la cámara, como girar la cabeza
    st.yaw -= dx * k; st.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, st.pitch + dy * k)); st.fly = null;
  });
  const end = e => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null; delete pts[e.pointerId];
    if (st.modo === '3d' && d.moved < 6 && e.timeStamp - d.t < 500 && e.type === 'pointerup') irAlPiso(e.clientX, e.clientY);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', e => {
    if (st.modo !== '3d') return; e.preventDefault();
    st.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, st.fov + Math.sign(e.deltaY) * 2.5));
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!st.open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code) && !e.metaKey && !e.ctrlKey && !e.altKey) { st.keys[e.code] = 1; st.goal = null; st.fly = null; e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener('keyup', e => { st.keys[e.code] = 0; }, true);
  window.addEventListener('blur', () => { st.keys = {}; });
  window.addEventListener('resize', () => { if (st.open) onResize(); });
}
function bindJoy() {
  const el = ui.joy; let id = null, c = null;
  const set = (x, y) => { st.joy = [x, y]; ui.knob.style.transform = `translate(${x * 30}px,${y * 30}px)`; };
  el.addEventListener('pointerdown', e => { id = e.pointerId; const r = el.getBoundingClientRect(); c = [r.left + r.width / 2, r.top + r.height / 2]; el.setPointerCapture(id); st.goal = null; st.fly = null; e.stopPropagation(); });
  el.addEventListener('pointermove', e => { if (e.pointerId !== id) return; let x = (e.clientX - c[0]) / 34, y = (e.clientY - c[1]) / 34; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } set(x, y); });
  const up = e => { if (e.pointerId !== id) return; id = null; set(0, 0); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
/* clic o toque en el piso: camina hasta ahí; si el punto no es caminable, hasta donde se pueda en esa dirección */
function irAlPiso(cx, cy) {
  const r = ui.canvas.getBoundingClientRect(), v = new THREE.Vector3((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height * 2 - 1), 0.5).unproject(gl.cam);
  const o = gl.cam.position, d = v.sub(o).normalize(); if (d.y > -0.03) return;                 // por encima del horizonte: no es piso
  const t = (st.nav.pisoY - o.y) / d.y; if (t > 30) return;
  let x = o.x + d.x * t, z = o.z + d.z * t;
  for (let k = 0; k < 40 && !caminable(x, z); k++) { x += (st.x - x) * 0.08; z += (st.z - z) * 0.08; }
  if (!caminable(x, z) || Math.hypot(x - st.x, z - st.z) < 0.15) return;
  st.goal = { x, z, quieto: 0 }; st.fly = null;
  gl.marca.position.set(x, st.nav.pisoY + 0.012, z); gl.marca.visible = true;
}
/* atajos del panel: la cámara vuela al punto del ambiente */
function volar(x, z) { st.goal = null; st.fly = { x0: st.x, z0: st.z, x1: x, z1: z, t: 0, d: Math.min(1.6, 0.5 + Math.hypot(x - st.x, z - st.z) / 9) }; }
function irA(id) {
  const p = st.nav.puntos.find(k => k.id === id); if (!p) return;
  if (st.modo === 'pano') { panoShow(id); return; }
  volar(p.pos[0], p.pos[2]);
}

/* ---------- WebGL ---------- */
function crearGL() {
  if (gl) return gl;
  const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;          // el look (AgX + exposición) ya viene horneado en las texturas: sRGB tal cual
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc9d6de);
  const cam = new THREE.PerspectiveCamera(FOV0, 16 / 9, 0.05, 1400); cam.rotation.order = 'YXZ';
  const marca = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
  marca.visible = false; marca.renderOrder = 3; scene.add(marca);
  const cesped = crearCesped(); scene.add(cesped);
  scene.fog = new THREE.Fog(BRUMA.pb, 8, 170);        // funde césped y vegetación lejana con el fondo; el modelo y la marca llevan fog = false
  marca.material.fog = false;
  gl = { renderer, scene, cam, marca, cesped, modelo: null, frames: 0, fpsT: 0, fps: 0 };
  return gl;
}
/* Estilos de decoración: tiñen los materiales del modelo (muebles, carpintería, piso y muros). «Natural» es el modelo tal como viene. */
const ESTILOS = {
  natural:     { t: 'Natural',     muestra: '#e8dcc8', muebles: 0xffffff, carp: 0xffffff, piso: 0xffffff, muros: 0xffffff },
  moderno:     { t: 'Moderno',     muestra: '#8d9299', muebles: 0xa9aeb6, carp: 0x6f6f72, piso: 0xdcdcdc, muros: 0xf2f3f4 },
  indie:       { t: 'Indie',       muestra: '#c9805a', muebles: 0xe0a47e, carp: 0xc98a52, piso: 0xe2bf96, muros: 0xf6e7cf },
  tradicional: { t: 'Tradicional', muestra: '#7a4f38', muebles: 0xc9a482, carp: 0x8a5c40, piso: 0xb98f68, muros: 0xeee0c8 },
  lila:        { t: 'Lila',        muestra: '#b9a4cc', muebles: 0xcbbbdc, carp: 0xb9a4a0, piso: 0xe9e2ec, muros: 0xf3eef6 }
};
let estilo = 'natural';
function aplicarEstilo() {
  const E = ESTILOS[estilo];
  if (gl && gl.modelo) gl.modelo.traverse(o => { if (!o.isMesh || o.material.transparent) return; const k = (o.material.name || '').split('_').pop(); if (E[k] !== undefined) o.material.color.setHex(E[k]); });
  if (ui) ui.root.querySelectorAll('[data-estilo]').forEach(b => b.classList.toggle('is-on', b.getAttribute('data-estilo') === estilo));
}
function cargarModelo(cfg, token) {
  const movil = esMovil();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return new Promise((ok, err) => loader.load(movil ? cfg.glbMovil : cfg.glb, g => ok(g), e => {
    if (token !== st.token) return;
    const tot = e.total || 0, p = tot ? Math.min(1, e.loaded / tot) : 0;
    ui.bar.style.width = (p * 100).toFixed(1) + '%'; ui.pct.textContent = tot ? Math.round(p * 100) + ' %' : (e.loaded / 1048576).toFixed(1) + ' MB';
  }, err)).then(g => {
    const aniso = Math.min(8, gl.renderer.capabilities.getMaxAnisotropy());
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      o.material.fog = false;
      if (o.material.map) o.material.map.anisotropy = aniso;
      if (o.material.transparent) {            // vidrio: casi invisible, para que no lave el color del jardín
        o.material.depthWrite = false; o.renderOrder = 2; o.material.color.setRGB(0.45, 0.52, 0.5); o.material.opacity = 0.07;
      }
    });
    return g.scene;
  });
}
/* fondo detrás de los vidrios: panorámica del nivel del depto, girada para que el lado verde quede hacia los ventanales
   principales. Si no existe, usa la panorámica anterior (entorno.webp). Se cambia en cada apertura, no solo al cargar el GLB. */
const fondos = {};
function ponerFondo(cfg, token) {
  const movil = esMovil(), url = movil ? cfg.entornoMovil : cfg.entorno;
  const usar = (t, giro) => { if (token !== st.token) return; gl.scene.background = t; gl.scene.backgroundRotation.set(0, giro, 0); };
  gl.scene.fog.color.setHex(BRUMA[cfg.nivel]);
  const cargar = (u, ok, err) => fondos[u] ? ok(fondos[u]) : new THREE.TextureLoader().load(u, t => {
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; fondos[u] = t; ok(t); }, undefined, err);
  cargar(url, t => usar(t, cfg.giroFondo), () => cargar(ENTORNO_RESPALDO[movil ? 1 : 0], t => usar(t, Math.PI), () => {}));
}
/* césped sin hornear a la altura del suelo exterior (y = 0 del modelo: bajo el piso en planta baja, 3,2 m abajo en planta alta).
   Llega hasta el horizonte (1200 m de lado) y la bruma lo funde con el suelo de la panorámica, así que no tiene borde visible.
   La variación sale de dos escalas: una textura fina de briznas y manchas grandes por color de vértice. */
function ruido(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function crearCesped() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), rnd = ruido(7);
  x.fillStyle = '#6f7d45'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {                                   // manchas medianas (0,3 – 1 m)
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 1), k = rnd(); g.addColorStop(0, k < 0.5 ? 'rgba(52,74,30,0.13)' : 'rgba(150,150,82,0.11)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    const px = rnd() * 256, py = rnd() * 256, r = 14 + rnd() * 34;
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) { x.setTransform(r, 0, 0, r * (0.6 + rnd() * 0.6), px + dx, py + dy); x.fillStyle = g; x.beginPath(); x.arc(0, 0, 1, 0, 6.3); x.fill(); }
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < 9000; i++) {                                 // briznas
    const g = 78 + rnd() * 70 | 0; x.fillStyle = `rgba(${g * (0.62 + rnd() * 0.3) | 0},${g},${g * 0.36 | 0},0.5)`;
    x.fillRect(rnd() * 256, rnd() * 256, 1, 1 + rnd() * 3);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(170, 170); t.rotation = 0.37; t.anisotropy = 8;
  const L = 1200, N = 150, geo = new THREE.PlaneGeometry(L, L, N, N).rotateX(-Math.PI / 2), pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const h = (i, j) => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
  const suave = (u, v) => { const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, a = fu * fu * (3 - 2 * fu), b = fv * fv * (3 - 2 * fv);
    return (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - b) + (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * b; };
  for (let k = 0; k < pos.count; k++) {
    const px = pos.getX(k), pz = pos.getZ(k), m = 0.55 * suave(px / 23 + 40, pz / 23 + 40) + 0.3 * suave(px / 61 + 9, pz / 61 + 9) + 0.15 * suave(px / 9, pz / 9);
    const seco = suave(px / 37 + 70, pz / 37 + 70);             // parches algo más secos / más oscuros
    col[k * 3] = 0.72 + 0.5 * m + 0.16 * seco; col[k * 3 + 1] = 0.74 + 0.48 * m; col[k * 3 + 2] = 0.7 + 0.4 * m - 0.1 * seco;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
  m.position.y = -0.015; m.renderOrder = -1; return m;
}
/* arbustos y árboles low-poly con alfa justo afuera del ventanal principal: dos planos cruzados por planta, con una copa
   dibujada en un canvas. Van en abanico frente al ventanal, sobre el césped, y tapan la unión entre el césped y el fondo. */
function texFollaje(seed, arbol) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), rnd = ruido(seed);
  if (arbol) { x.fillStyle = '#3d3122'; x.beginPath(); x.moveTo(121, 256); x.lineTo(125, 140); x.lineTo(132, 140); x.lineTo(136, 256); x.fill(); }
  /* copa irregular: varios lóbulos, cada uno con hojas pequeñas; más claras arriba (sol) y oscuras abajo y al centro */
  const lob = []; const nl = arbol ? 7 : 6;
  for (let i = 0; i < nl; i++) lob.push(arbol ? [128 + (rnd() - 0.5) * 120, 40 + rnd() * 110, 34 + rnd() * 26] : [128 + (rnd() - 0.5) * 170, 150 + rnd() * 60, 36 + rnd() * 24]);
  for (let i = 0; i < 2600; i++) {
    const l = lob[i % nl], a = rnd() * 6.283, r = Math.pow(rnd(), 0.6) * l[2], px = l[0] + Math.cos(a) * r, py = l[1] + Math.sin(a) * r * 0.85;
    if (py > 253 || py < 3 || px < 3 || px > 253) continue;
    const arriba = 1 - (py - (l[1] - l[2])) / (2 * l[2]), luz = 0.2 + 0.65 * arriba + (rnd() - 0.5) * 0.3, g = 32 + 94 * Math.max(0, Math.min(1, luz)) | 0;
    x.fillStyle = `rgb(${g * (0.84 + rnd() * 0.08) | 0},${g},${g * (0.58 + rnd() * 0.08) | 0})`;      // verde del HDRI: sombra (26,34,21), sol (116,128,79)
    x.beginPath(); x.ellipse(px, py, 2.5 + rnd() * 4.5, 1.8 + rnd() * 3.2, rnd() * 3.1, 0, 6.3); x.fill();
  }
  if (arbol) {                                                    // árboles: copia desenfocada, para que se fundan con el fondo (que también va desenfocado)
    const d = document.createElement('canvas'); d.width = d.height = 256; const y = d.getContext('2d'); y.filter = 'blur(2.2px)'; y.drawImage(c, 0, 0); y.filter = 'none'; x.clearRect(0, 0, 256, 256); x.drawImage(d, 0, 0);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
let matsFollaje = null;
function crearVegetacion(cfg, nav) {
  if (!matsFollaje) matsFollaje = [[11, 0], [23, 0], [37, 1], [53, 1]].map(([sd, ar]) =>
    new THREE.MeshBasicMaterial({ map: texFollaje(sd, ar), alphaTest: ar ? 0.38 : 0.5, side: THREE.DoubleSide }));
  const g = new THREE.Group(), rnd = ruido(100 + cfg.n * 17), v = VENTANAL[cfg.n], az = Math.atan2(v[1], v[0]);
  const c = nav.puntos[0].pos, alta = cfg.nivel === 'pa';
  const planta = (x, z, alto, ancho, mat) => { for (const giro of [0, Math.PI / 2]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto), mat); m.position.set(x, alto / 2 - 0.02, z); m.rotation.y = giro + rnd() * 0.6; g.add(m); } };
  /* seto: arbustos solapados en arco; detrás, árboles. Radios medidos desde la sala, fuera del depto y sus terrazas. */
  for (let k = 0; k < 26; k++) { const a = az + (k / 25 - 0.5) * 2.5 + (rnd() - 0.5) * 0.05, r = (alta ? 15 : 17) + rnd() * 3;
    planta(c[0] + Math.cos(a) * r, c[2] + Math.sin(a) * r, (alta ? 2.6 : 2.2) + rnd() * 1.4, 3.2 + rnd() * 1.4, matsFollaje[k % 2]); }
  /* árboles: 9, detrás del seto y fuera de primer plano. La distancia se mide desde el ventanal (el borde del piso caminable
     hacia ese lado), no desde la sala: el más cercano queda a 22 m o más del vidrio. */
  const ext = nav.caminable.exterior; let borde = 0;
  for (const q of ext) borde = Math.max(borde, (q[0] - c[0]) * v[0] + (q[1] - c[2]) * v[1]);
  for (let k = 0; k < 9; k++) { const da = (k / 8 - 0.5) * 2.2 + (rnd() - 0.5) * 0.1, d = 22 + rnd() * 26, r = (borde + d) / Math.max(Math.cos(da), 0.45);
    planta(c[0] + Math.cos(az + da) * r, c[2] + Math.sin(az + da) * r, (alta ? 7 : 6) + rnd() * 3.5, 5.5 + rnd() * 3, matsFollaje[2 + k % 2]); }
  return g;
}
function onResize() {
  if (!st.open) return;
  if (st.modo === 'pano') { panoApply(); return; }
  if (!gl) return;
  const w = ui.stage.clientWidth, h = ui.stage.clientHeight; if (!w || !h) return;
  gl.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, esMovil() ? 1.5 : 2));
  gl.renderer.setSize(w, h, false); gl.cam.aspect = w / h; gl.cam.updateProjectionMatrix();
}
function frame(t) {
  if (!st.open || st.modo !== '3d') { st.raf = 0; return; }
  st.raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - st.last) / 1000 || 0); st.last = t;
  const k = st.keys, f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) - st.joy[1], s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + st.joy[0];
  if (st.fly) {                                                    // vuelo a un ambiente: interpolación suave, sin colisión
    const a = st.fly; a.t = Math.min(1, a.t + dt / a.d); const e = a.t * a.t * (3 - 2 * a.t);
    st.x = a.x0 + (a.x1 - a.x0) * e; st.z = a.z0 + (a.z1 - a.z0) * e; if (a.t >= 1) st.fly = null;
  } else if (f || s) {
    const m = Math.max(1, Math.hypot(f, s)), sy = Math.sin(st.yaw), cy = Math.cos(st.yaw);
    mover((sy * f + cy * s) / m * VEL * dt, (-cy * f + sy * s) / m * VEL * dt);
  } else if (st.goal) {                                            // clic en el piso: camina hasta el punto
    const g = st.goal, dx = g.x - st.x, dz = g.z - st.z, d = Math.hypot(dx, dz), paso = Math.min(d, VEL * 1.25 * dt);
    const x0 = st.x, z0 = st.z;
    if (d < 0.04 || !mover(dx / d * paso, dz / d * paso)) st.goal = null;
    else { g.quieto = Math.hypot(st.x - x0, st.z - z0) < paso * 0.3 ? g.quieto + dt : 0; if (g.quieto > 0.35) st.goal = null; }
  }
  if (!st.goal && gl.marca.visible) gl.marca.visible = false;
  const c = gl.cam;
  c.position.set(st.x, st.nav.pisoY + ALTURA, st.z); c.rotation.set(st.pitch, -st.yaw, 0);
  if (Math.abs(c.fov - st.fov) > 0.01) { c.fov += (st.fov - c.fov) * Math.min(1, dt * 10); c.updateProjectionMatrix(); }
  gl.renderer.render(gl.scene, c);
  gl.frames++; if (t - gl.fpsT > 1000) { gl.fps = Math.round(gl.frames * 1000 / (t - gl.fpsT)); gl.frames = 0; gl.fpsT = t; }
  pintarPanel();
}

/* ---------- panel: título, minimapa en vivo, ambientes ---------- */
function pintarPanel() {
  const p = st.cfg.plano;
  ui.yo.style.left = ((p.x0 + st.x * p.k) / p.w * 100).toFixed(2) + '%';
  ui.yo.style.top = ((p.y0 + st.z * p.k) / p.h * 100).toFixed(2) + '%';
  ui.yo.style.setProperty('--giro', (st.yaw * 180 / Math.PI).toFixed(1) + 'deg');
  ui.yo.style.setProperty('--cono', (st.modo === 'pano' ? 80 : st.fov * 1.25).toFixed(0) + 'deg');
  const a = st.modo === 'pano' ? st.nav.puntos.find(k => k.id === st.pano.id) : ambienteCerca();
  if (a && a.id !== st.room) {
    st.room = a.id; ui.room.textContent = st.cfg.nombres[a.id] || a.nombre;
    ui.thumbs.querySelectorAll('button').forEach(b => { const on = b.getAttribute('data-room') === a.id; b.classList.toggle('is-on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  }
}
function armarPanel() {
  const cfg = st.cfg, n = st.n;
  ui.unit.textContent = 'Departamento ' + n; ui.count.textContent = cfg.piso;
  ui.planImg.src = cfg.plano.src; ui.planImg.alt = 'Plano del departamento ' + n;
  ui.thumbs.classList.toggle('rec-sinfotos', !cfg.panos);
  ui.thumbs.innerHTML = st.nav.puntos.map((p, k) =>
    `<button type="button" data-room="${esc(p.id)}">` + (cfg.panos ? `<span class="intr-th"><img src="${esc(cfg.panos + p.id)}_m.webp" alt="" draggable="false" decoding="async"></span>` : '') +
    `<span class="intr-cap"><i>${k < 9 ? '0' : ''}${k + 1}</i>${esc(cfg.nombres[p.id] || p.nombre)}</span></button>`).join('');
  ui.thumbs.querySelectorAll('img').forEach(im => { const ok = () => im.classList.add('is-ready'); if (im.complete && im.naturalWidth) ok(); else im.addEventListener('load', ok); });
  st.room = null;
}

/* ---------- respaldo sin WebGL: panorámicas por ambiente, arrastrando para girar ---------- */
function panoShow(id) {
  const p = st.nav.puntos.find(k => k.id === id) || st.nav.puntos[0];
  st.pano = { id: p.id, off: 0, v: 0 }; st.x = p.pos[0]; st.z = p.pos[2];
  ui.pano.style.backgroundImage = `url("${st.cfg.panos + p.id}${esMovil() ? '_m' : ''}.webp")`;
  panoApply();
}
function panoApply() {
  const h = ui.stage.clientHeight, alto = h * 2.3, ancho = alto * 2;          // se ve una franja de ~78° de alto
  ui.pano.style.backgroundSize = `${ancho}px ${alto}px`;
  ui.pano.style.backgroundPosition = `${(ui.stage.clientWidth / 2 - ancho / 2 - st.pano.off).toFixed(1)}px ${(-(alto - h) / 2 - st.pano.v * (alto - h) / 4).toFixed(1)}px`;
  st.yaw = st.pano.off / ancho * Math.PI * 2;                                 // el centro de la panorámica mira al norte del plano
  pintarPanel();
}
function sinWebGL() {
  if (params.get('panos') === '1') return true;
  if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;       // equipo débil
  try { const c = document.createElement('canvas'); return !(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return true; }
}

/* ---------- abrir / cerrar ---------- */
function emit(name) { try { window.dispatchEvent(new CustomEvent(name, { detail: { unit: st.n } })); } catch (e) { /* nadie escucha */ } }
function setHash(h) { try { history.replaceState(null, '', h || (location.pathname + location.search)); } catch (e) { /* file:// */ } }
function textos() {
  const m = esMovil();
  ui.tip.textContent = st.modo === 'pano' ? 'Arrastra para mirar alrededor' : m ? 'Arrastra para mirar · toca el piso para caminar' : 'Arrastra para mirar · clic en el piso o WASD para caminar';
  ui.hint.textContent = st.modo === 'pano' ? 'Vista panorámica · Esc cierra' : 'WASD o flechas caminan · ruedita acerca · Esc cierra';
  ui.root.classList.toggle('is-pano', st.modo === 'pano'); ui.root.classList.toggle('is-touch', m);
}
async function open(n, roomId) {
  if (!has(n)) return false;
  if (!ui) build();
  if (previo && previo.isOpen()) previo.close();          // p. ej. enlace directo #interior/3: el visor de fotos alcanzó a abrirse antes
  const cfg = RECORRIDOS[n], token = ++st.token;
  if (!st.open) { st.prevHash = /^#interior\//.test(location.hash) ? '' : location.hash; st.focus = document.activeElement; }
  Object.assign(st, { open: true, n: Number(n), cfg, keys: {}, joy: [0, 0], goal: null, fly: null, fov: FOV0, pitch: 0 });
  ui.root.hidden = false; ui.root.classList.remove('is-folded'); document.documentElement.classList.add('intr-lock');
  ui.load.hidden = false; ui.load.classList.remove('is-err'); ui.bar.style.width = '0%'; ui.pct.textContent = '0 %'; ui.loadT.textContent = 'Cargando el departamento ' + n;
  ui.tip.classList.remove('is-off'); setHash('#interior/' + n); emit('alheli:interior-open');
  try {
    const c = cache[n] || (cache[n] = {});
    st.nav = c.nav || (c.nav = await fetch(cfg.nav).then(r => { if (!r.ok) throw new Error('nav ' + r.status); return r.json(); }));
    if (token !== st.token) return true;
    const ini = st.nav.inicio, pt = roomId && st.nav.puntos.find(k => k.id === roomId);
    st.x = pt ? pt.pos[0] : ini.pos[0]; st.z = pt ? pt.pos[2] : ini.pos[2];
    st.yaw = Math.atan2(ini.mirar[0] - ini.pos[0], -(ini.mirar[2] - ini.pos[2]));      // arranca mirando hacia la sala y el comedor
    armarPanel();
    if (sinWebGL()) { if (!cfg.panos) { ui.load.classList.add('is-err'); ui.loadT.textContent = 'Este recorrido necesita un navegador con WebGL.'; return false; } throw new Error('sin WebGL'); }
    st.modo = '3d'; ui.pano.hidden = true; ui.canvas.hidden = false; textos();
    crearGL(); ponerFondo(cfg, token);
    if (!c.veg) c.veg = crearVegetacion(cfg, st.nav);
    if (gl.veg !== c.veg) { if (gl.veg) gl.scene.remove(gl.veg); gl.scene.add(c.veg); gl.veg = c.veg; }
    if (!c.scene) c.scene = await cargarModelo(cfg, token);
    if (token !== st.token) return true;
    if (gl.modelo !== c.scene) { if (gl.modelo) gl.scene.remove(gl.modelo); gl.scene.add(c.scene); gl.modelo = c.scene; }
    aplicarEstilo();
    ui.bar.style.width = '100%'; ui.pct.textContent = '100 %';
    onResize(); st.last = performance.now(); gl.fpsT = st.last; gl.frames = 0;
    if (!st.raf) st.raf = requestAnimationFrame(frame);
    requestAnimationFrame(() => { ui.load.hidden = true; });
  } catch (err) {
    if (token !== st.token) return true;
    if (!st.nav) { ui.load.classList.add('is-err'); ui.loadT.textContent = 'No se pudo cargar el recorrido de este departamento.'; return false; }
    if (!cfg.panos) { ui.load.classList.add('is-err'); ui.loadT.textContent = 'No se pudo cargar el recorrido de este departamento.'; return false; }
    st.modo = 'pano'; ui.canvas.hidden = true; ui.pano.hidden = false; textos();      // respaldo: panorámicas
    panoShow(roomId || st.nav.puntos[0].id); ui.load.hidden = true;
  }
  ui.x.focus({ preventScroll: true });
  return true;
}
function close() {
  if (!st.open) return;
  st.open = false; st.token++; st.keys = {}; st.goal = null; st.fly = null;
  if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
  ui.root.hidden = true; document.documentElement.classList.remove('intr-lock');
  if (/^#interior\//.test(location.hash)) setHash(st.prevHash || '');
  emit('alheli:interior-close');
  if (st.focus && st.focus.focus && document.contains(st.focus)) { try { st.focus.focus({ preventScroll: true }); } catch (e) { /* ya no está */ } }
}

/* ---------- enganche con el sitio ---------- */
const api = { has, open, close, roomFor, isOpen: () => st.open, estado: () => ({ modo: st.modo, x: st.x, z: st.z, yaw: st.yaw, fps: gl ? gl.fps : 0, movil: esMovil() }), _st: st, _mover: mover, _caminable: (x, z) => caminable(x, z) };
window.AlheliRecorrido = api;
const A = window.AlheliInteriores;
if (A) {
  const o = previo = { has: A.has, open: A.open, isOpen: A.isOpen, preload: A.preload, roomFor: A.roomFor, close: A.close };
  A.has = n => has(n) || o.has(n);
  A.open = (n, room) => has(n) ? open(n, room) : o.open(n, room);
  A.isOpen = () => st.open || o.isOpen();
  A.preload = n => { if (!has(n)) o.preload(n); };
  A.roomFor = (n, name) => has(n) ? roomFor(n, name) : o.roomFor(n, name);
  A.close = () => { if (st.open) close(); else o.close(); };
}
/* #interior/1 o #interior/1/sala: abre directo */
function desdeHash() {
  const m = /^#interior\/(\d+)(?:\/([\w-]+))?\/?$/.exec(location.hash || '');
  if (m && has(m[1])) { if (!st.open || st.n !== Number(m[1])) open(Number(m[1]), m[2] || null); else if (m[2] && st.nav) irA(m[2]); }
  else if (st.open && !/^#interior\//.test(location.hash)) close();
}
window.addEventListener('hashchange', desdeHash);
desdeHash();
