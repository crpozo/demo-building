/* Alhelí — visor de interiores: fotos por ambiente, a pantalla completa, con paso de un ambiente al siguiente
   y la posibilidad de mirar alrededor arrastrando (las fotos son planas: no es un 360).
   Todo sale del diccionario INTERIORES: una unidad tiene «Ver interior» y visor solo si está ahí; las demás siguen
   con el recorrido 3D. Para sumar otro departamento alcanza con agregar su entrada y sus imágenes. */
(function (global) {
  'use strict';

  /* Por ambiente:
       id, name   nombre del ambiente (id va en el hash: #interior/3/sala)
       src, w, h  foto y su tamaño en px
       map        caja del ambiente en el plano de la unidad: [x, y, ancho, alto] en % del jpg
       prev, next dónde apoyan en el piso las flechas hacia el ambiente anterior y el siguiente del recorrido:
                  x, y en % de la foto; rot 0 = hacia el fondo, 90 = a la derecha, -90 = a la izquierda;
                  lab (opcional) mueve la etiqueta para que no pise a la otra: 'r' o 'l' al costado, 's' o 'e' arriba pero
                  alineada al borde izquierdo o derecho de la flecha
                  La foto se muestra con zoom (BASE), así que en reposo solo se ve del 8 % al 92 % de cada eje:
                  las flechas van dentro de esa zona.
     El recorrido sigue el orden de la lista y es circular: del último se pasa al primero y al revés. */
  var INTERIORES = {
    3: {
      floor: 'pb',
      plan: 'img/pisos/u3.jpg',
      rooms: [
        { id: 'sala', name: 'Sala', src: 'img/interiores/d3/sala.webp', w: 1920, h: 1194,
          map: [55.3, 32.9, 12.7, 32.9],
          prev: { x: 52.5, y: 85.5, rot: -90, lab: 'e' }, next: { x: 85, y: 86.5, rot: 85 } },
        { id: 'comedor', name: 'Comedor', src: 'img/interiores/d3/comedor.webp', w: 1920, h: 1200,
          map: [68.0, 32.9, 11.6, 32.9],
          prev: { x: 37, y: 85, rot: -90 }, next: { x: 78.5, y: 88, rot: 80 } },
        { id: 'cocina', name: 'Cocina', src: 'img/interiores/d3/cocina.webp', w: 1920, h: 1200,
          map: [79.6, 30.9, 16.4, 41.5],
          prev: { x: 18, y: 88.5, rot: -85 }, next: { x: 30, y: 89.5, rot: 85, lab: 'r' } },
        { id: 'dormitorio-master', name: 'Dormitorio máster', src: 'img/interiores/d3/dormitorio-master.webp', w: 1920, h: 1200,
          map: [13.3, 31.3, 16.0, 33.7],
          prev: { x: 14.5, y: 86, rot: -90 }, next: { x: 81, y: 82, rot: 80 } }
      ]
    }
  };

  var base = '';
  var ui = null;                 /* nodos del visor; se arma la primera vez que se abre */
  var cache = {};                /* fotos precargadas, por URL */
  var st = { open: false, n: null, unit: null, i: 0, front: 0, token: 0, prev: null, focus: null, swiped: 0, folded: false };

  function src(p) { return base + p; }
  function has(n) { return Object.prototype.hasOwnProperty.call(INTERIORES, String(n)); }
  function roomIndex(unit, id) {
    for (var k = 0; k < unit.rooms.length; k++) if (unit.rooms[k].id === id) return k;
    return -1;
  }
  function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
  /* id del ambiente de la unidad n que se llama así («Sala», «Dormitorio máster»…), o null */
  function roomFor(n, name) {
    if (!has(n)) return null;
    var want = norm(name), rooms = INTERIORES[n].rooms;
    for (var k = 0; k < rooms.length; k++) if (norm(rooms[k].name) === want) return rooms[k].id;
    return null;
  }
  /* trae las fotos de la unidad antes de que se abra el visor (al abrir su panel o al pasar por «Ver interior») */
  function preload(n) {
    if (!has(n)) return;
    INTERIORES[n].rooms.forEach(function (r) {
      var u = src(r.src);
      if (!cache[u]) { cache[u] = new Image(); cache[u].decoding = 'async'; cache[u].src = u; }
    });
  }
  function parseHash(h) {
    var m = /^#interior\/(\d+)(?:\/([\w-]+))?\/?$/.exec(h || '');
    return m ? { n: Number(m[1]), room: m[2] || null } : null;
  }
  function setHash(h) {
    try { history.replaceState(null, '', h || (location.pathname + location.search)); } catch (e) { /* file:// u otros: el visor funciona igual sin hash */ }
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function emit(name) {
    try { global.dispatchEvent(new CustomEvent(name, { detail: { unit: st.n } })); } catch (e) { /* sin CustomEvent: nadie escucha */ }
  }
  function isSheet() { return !!(global.matchMedia && global.matchMedia('(max-width:768px)').matches); }

  /* flecha del piso: dos chevrons que apuntan hacia arriba; el CSS los acuesta sobre el suelo y los gira hacia el destino */
  var CHEVRON =
    '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<g class="c2"><path class="sh" d="M22 86 50 62 78 86"/><path class="ln" d="M22 86 50 62 78 86"/></g>' +
      '<g class="c1"><path class="sh" d="M22 54 50 30 78 54"/><path class="ln" d="M22 54 50 30 78 54"/></g>' +
    '</svg>';
  var ARROW = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>'; };

  function build() {
    var root = document.createElement('div');
    root.className = 'intr';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.hidden = true;
    /* eyebrow, btn gold y menu-btn son las clases del header y las secciones del sitio */
    root.innerHTML =
      '<div class="intr-stage">' +
        '<div class="intr-box is-empty">' +                       /* recuadro de la foto: recorta lo que sobra del zoom */
          '<div class="intr-pan">' +                              /* lo que se mueve al mirar alrededor: fotos y flechas del piso */
            '<img class="intr-img" alt="" draggable="false" decoding="async">' +
            '<img class="intr-img" alt="" draggable="false" decoding="async">' +
            '<div class="intr-gos"></div>' +
          '</div>' +
          '<div class="intr-skel" aria-hidden="true"></div>' +
          '<span class="intr-tag">Imagen ilustrativa</span>' +
          '<div class="intr-look" aria-hidden="true">' + ARROW('M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v5a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-4-2l-3-4.2a1.5 1.5 0 0 1 2.4-1.8L9 15') + '<span>Arrastra para mirar alrededor</span></div>' +
        '</div>' +
        '<p class="intr-msg" hidden>No se pudo cargar la imagen de este ambiente.</p>' +
        '<button class="intr-nav intr-prev" type="button" aria-label="Ambiente anterior">' + ARROW('M14.5 5.5 8 12l6.5 6.5') + '</button>' +
        '<button class="intr-nav intr-next" type="button" aria-label="Ambiente siguiente">' + ARROW('M9.5 5.5 16 12l-6.5 6.5') + '</button>' +
      '</div>' +
      '<button class="menu-btn intr-x" type="button" aria-label="Cerrar el visor de interiores">' + ARROW('M6 6l12 12M18 6 6 18') + '</button>' +
      '<aside class="intr-panel">' +
        '<div class="intr-bar">' +
          '<i class="intr-grab" aria-hidden="true"></i>' +
          '<div class="intr-title" aria-live="polite"><p class="eyebrow intr-unit"></p><h2 class="intr-room"></h2></div>' +
          '<span class="intr-count"></span>' +
          '<button class="intr-fold" type="button" aria-expanded="true" aria-label="Contraer el panel">' + ARROW('M6 9.5l6 6 6-6') + '</button>' +
        '</div>' +
        '<div class="intr-body">' +
          '<div class="intr-map"><p class="eyebrow">En el plano</p><div class="intr-plan"><img alt="" draggable="false"></div></div>' +
          '<div class="intr-rooms"><p class="eyebrow">Ambientes</p><div class="intr-thumbs" role="group" aria-label="Ambientes"></div></div>' +
        '</div>' +
        '<div class="intr-foot">' +
          '<button class="btn gold" type="button" data-asesor>Hablar con un asesor</button>' +
          '<p class="intr-hint">← → cambia de ambiente · Esc cierra</p>' +
        '</div>' +
      '</aside>';
    document.body.appendChild(root);

    var q = function (s) { return root.querySelector(s); };
    ui = {
      root: root, stage: q('.intr-stage'), imgs: root.querySelectorAll('.intr-img'), box: q('.intr-box'), pan: q('.intr-pan'), gos: q('.intr-gos'), msg: q('.intr-msg'),
      unit: q('.intr-unit'), room: q('.intr-room'), count: q('.intr-count'), x: q('.intr-x'), bar: q('.intr-bar'), fold: q('.intr-fold'),
      prev: q('.intr-prev'), next: q('.intr-next'), plan: q('.intr-plan'), planImg: q('.intr-plan img'), thumbs: q('.intr-thumbs')
    };

    ui.x.addEventListener('click', function () { close(); });
    ui.prev.addEventListener('click', function (e) { e.stopPropagation(); step(-1); });
    ui.next.addEventListener('click', function (e) { e.stopPropagation(); step(1); });

    root.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      /* «Hablar con un asesor»: cierra el visor y deja que el sitio abra su formulario, como el botón del header */
      if (e.target.closest('[data-asesor]')) { close(); return; }
      /* miniaturas, plano y flechas del piso: todos llevan data-room */
      var b = e.target.closest('[data-room]');
      if (!b || Date.now() - st.swiped < 400) return;
      var k = roomIndex(st.unit, b.getAttribute('data-room'));
      if (k >= 0) show(k);
    });

    /* clic en la banda oscura, fuera de la foto: cierra (solo con mouse; con el dedo sería fácil cerrarlo sin querer) */
    ui.stage.addEventListener('click', function (e) {
      if (Date.now() - st.swiped < 400 || !global.matchMedia || !global.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
      if (e.target.closest('[data-room]')) return;
      var r = ui.box.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });

    lookBind();      /* arrastrar para mirar alrededor, zoom con rueda o pinch (reemplaza al deslizar para cambiar de ambiente) */

    /* móvil: el panel es una hoja inferior; se contrae a su barra (ambiente y «n / 4») tocándola o deslizándola hacia abajo */
    var drag = null;
    ui.bar.addEventListener('pointerdown', function (e) { drag = { id: e.pointerId, y: e.clientY }; });
    ui.bar.addEventListener('pointerup', function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      var dy = e.clientY - drag.y;
      drag = null;
      if (isSheet() && Math.abs(dy) >= 24) { st.swiped = Date.now(); setFolded(dy > 0); }
    });
    ui.bar.addEventListener('pointercancel', function () { drag = null; });
    ui.bar.addEventListener('click', function () {
      if (isSheet() && Date.now() - st.swiped >= 400) setFolded(!st.folded);
    });

    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(ui.stage);
    global.addEventListener('resize', layout);
  }

  function setFolded(on) {
    st.folded = !!on;
    ui.root.classList.toggle('is-folded', st.folded);
    ui.fold.setAttribute('aria-expanded', String(!st.folded));
    ui.fold.setAttribute('aria-label', st.folded ? 'Desplegar el panel' : 'Contraer el panel');
  }

  /* La foto va con object-fit: contain, así que no ocupa todo el escenario. Las flechas del piso, la etiqueta y el
     esqueleto de carga se anclan a esta caja, que es el recuadro real de la foto, y no a la ventana. */
  function layout() {
    if (!st.open) return;
    var room = st.unit.rooms[st.i], im = ui.imgs[st.front];
    var ar = (im.naturalWidth && im.naturalHeight && im.getAttribute('data-room-id') === room.id) ? im.naturalWidth / im.naturalHeight : room.w / room.h;
    var sw = ui.stage.clientWidth, sh = ui.stage.clientHeight;
    if (!sw || !sh) return;
    var w = Math.min(sw, sh * ar), h = w / ar;
    ui.box.style.left = (sw - w) / 2 + 'px';
    ui.box.style.top = (sh - h) / 2 + 'px';
    ui.box.style.width = w + 'px';
    ui.box.style.height = h + 'px';
    ui.box.style.setProperty('--bw', w + 'px');
    look.W = w; look.H = h; look.lim = {};
    lookClamp();
    lookApply();
  }

  /* ---------- mirar alrededor ----------
     Las fotos son planas: no es un 360. La foto se muestra con zoom (BASE) dentro de su recuadro y sobra margen a los lados.
     Arrastrar la desplaza en sentido contrario al arrastre, como girar la cabeza, con una leve rotación 3D; al soltar sigue
     con inercia. La rueda o el pinch acercan hasta ZMAX y el doble clic vuelve al zoom inicial. Las flechas del piso van
     en el mismo contenedor transformado (.intr-pan), así quedan pegadas al piso.
     El desplazamiento se limita de modo que nunca se vea el borde de la foto: se proyectan sus cuatro esquinas con la misma
     transformación del CSS y se comprueba que el recuadro siga cubierto. */
  var BASE = 1.18, ZMAX = 1.6;          /* zoom inicial y máximo */
  var MAXX = 0.07, MAXY = 0.03;         /* desplazamiento máximo con el zoom inicial: ±7 % del ancho, ±3 % del alto */
  var ROTY = 4, ROTX = 2;               /* giro máximo, en grados */
  var PARA = 0.015;                     /* parallax con el mouse, sin arrastrar: ±1,5 % */
  var LERP = 0.12, PERSP = 1200;
  var DIR = -1;                         /* -1: la foto va en sentido contrario al arrastre (girar la cabeza); 1: la foto sigue al dedo */
  var HINT_KEY = 'alheli.interiores.mirar';
  var RAD = Math.PI / 180;
  var look = { x: 0, y: 0, z: BASE, px: 0, py: 0, tz: BASE, par: [0, 0], raf: 0, drag: null, pts: {}, pinch: null, tap: null, W: 0, H: 0, lim: {}, hint: 0 };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lookRot(x, y) {              /* el giro acompaña al desplazamiento: mirar a la derecha aleja el lado derecho de la foto */
    return [clamp(-x / (MAXX * look.W || 1), -1, 1) * ROTY, clamp(y / (MAXY * look.H || 1), -1, 1) * ROTX];
  }
  /* ¿la foto transformada sigue cubriendo todo el recuadro? Misma cuenta que
     perspective(P) rotateY(ry) rotateX(rx) translate(x, y) scale(z), con origen en el centro */
  function lookCovers(x, y, z) {
    var W = look.W / 2, H = look.H / 2, r = lookRot(x, y), ry = r[0] * RAD, rx = r[1] * RAD;
    var cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
    var q = [[-W, -H], [W, -H], [W, H], [-W, H]].map(function (c) {
      var X = c[0] * z + x, Y = c[1] * z + y, Y1 = Y * cx, Z1 = Y * sx, X2 = X * cy + Z1 * sy, Z2 = -X * sy + Z1 * cy, k = PERSP / (PERSP - Z2);
      return [X2 * k, Y1 * k];
    });
    var pts = [[-W - 1, -H - 1], [W + 1, -H - 1], [W + 1, H + 1], [-W - 1, H + 1]];      /* 1 px de holgura */
    for (var i = 0; i < 4; i++) {
      var a = q[i], b = q[(i + 1) % 4];
      for (var j = 0; j < 4; j++) if ((b[0] - a[0]) * (pts[j][1] - a[1]) - (b[1] - a[1]) * (pts[j][0] - a[0]) < 0) return false;
    }
    return true;
  }
  /* hasta dónde se puede desplazar con ese zoom: lo pedido (más lo que agrega el zoom), recortado a lo que no muestra el borde */
  function lookLimits(z) {
    var key = z.toFixed(3);
    if (look.lim[key]) return look.lim[key];
    var wx = MAXX * look.W + (z - BASE) * look.W / 2, wy = MAXY * look.H + (z - BASE) * look.H / 2;
    var ok = function (k) { return lookCovers(wx * k, wy * k, z) && lookCovers(-wx * k, wy * k, z) && lookCovers(wx * k, -wy * k, z) && lookCovers(-wx * k, -wy * k, z); };
    var k = 1;
    if (!look.W || !ok(1)) {
      var lo = 0, hi = 1;
      for (var i = 0; i < 12; i++) { k = (lo + hi) / 2; if (ok(k)) lo = k; else hi = k; }
      k = lo;
    }
    return (look.lim[key] = { mx: Math.max(0, wx * k), my: Math.max(0, wy * k) });
  }
  function lookClamp() {
    var L = lookLimits(look.tz), C = lookLimits(look.z);
    look.px = clamp(look.px, -L.mx, L.mx); look.py = clamp(look.py, -L.my, L.my);
    look.x = clamp(look.x, -C.mx, C.mx); look.y = clamp(look.y, -C.my, C.my);
  }
  function lookApply() {
    if (!ui) return;
    var r = lookRot(look.x, look.y);
    ui.pan.style.transform = 'perspective(' + PERSP + 'px) rotateY(' + r[0].toFixed(3) + 'deg) rotateX(' + r[1].toFixed(3) + 'deg) translate(' + look.x.toFixed(2) + 'px,' + look.y.toFixed(2) + 'px) scale(' + look.z.toFixed(4) + ')';
    ui.pan.style.setProperty('--iz', (1 / look.z).toFixed(4));      /* las flechas del piso no crecen con el zoom */
  }
  /* un cuadro: lo mostrado se acerca al objetivo con lerp; el bucle se detiene solo cuando ya no hay movimiento */
  function lookFrame() {
    look.raf = 0;
    if (!st.open) return;
    var L = lookLimits(look.tz);
    var gx = clamp(look.px + look.par[0], -L.mx, L.mx), gy = clamp(look.py + look.par[1], -L.my, L.my);
    look.z += (look.tz - look.z) * LERP;
    look.x += (gx - look.x) * LERP;
    look.y += (gy - look.y) * LERP;
    var still = Math.abs(gx - look.x) < 0.05 && Math.abs(gy - look.y) < 0.05 && Math.abs(look.tz - look.z) < 0.0005;
    if (still) { look.x = gx; look.y = gy; look.z = look.tz; }
    var C = lookLimits(look.z);
    look.x = clamp(look.x, -C.mx, C.mx); look.y = clamp(look.y, -C.my, C.my);
    lookApply();
    if (!still) look.raf = requestAnimationFrame(lookFrame);
  }
  function lookKick() { if (st.open && !look.raf) look.raf = requestAnimationFrame(lookFrame); }
  /* vuelve al centro y al zoom inicial; con snap, sin animar (al abrir) */
  function lookReset(snap) {
    look.px = look.py = 0; look.tz = BASE; look.drag = look.pinch = null; look.pts = {};
    if (ui) ui.root.classList.remove('is-drag');
    if (snap) { look.x = look.y = 0; look.z = BASE; look.par = [0, 0]; lookApply(); } else lookKick();
  }
  function lookZoom(z) { look.tz = clamp(z, BASE, ZMAX); lookClamp(); lookKick(); }

  /* aviso «Arrastra para mirar alrededor»: solo la primera vez; se va con el primer arrastre o a los 3 s */
  function hintShow() {
    var seen = true;
    try { seen = !!localStorage.getItem(HINT_KEY); if (!seen) localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* sin localStorage: no se muestra */ }
    if (seen) return;
    ui.root.classList.add('is-hint');
    look.hint = setTimeout(hintHide, 3000);
  }
  function hintHide() { clearTimeout(look.hint); look.hint = 0; if (ui) ui.root.classList.remove('is-hint'); }

  function lookBind() {
    var stage = ui.stage;
    var fine = function () { return !!(global.matchMedia && global.matchMedia('(hover:hover) and (pointer:fine)').matches); };
    var calm = function () { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion:reduce)').matches); };
    var count = function () { return Object.keys(look.pts).length; };
    var gap = function () { var k = Object.keys(look.pts), a = look.pts[k[0]], b = look.pts[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };

    stage.addEventListener('pointerdown', function (e) {
      if ((e.pointerType === 'mouse' && e.button !== 0) || (e.target.closest && e.target.closest('.intr-nav'))) return;
      look.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (count() === 2) {                                   /* segundo dedo: pinch */
        look.pinch = { d: gap(), z: look.tz };
        if (look.drag) look.drag.moved = true;               /* ya no es un toque simple */
        st.swiped = Date.now();
      } else if (count() === 1) {
        look.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: look.px, py: look.py, moved: false, lx: e.clientX, ly: e.clientY, lt: e.timeStamp, vx: 0, vy: 0 };
      }
    });
    stage.addEventListener('pointermove', function (e) {
      var p = look.pts[e.pointerId];
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (look.pinch && count() >= 2) { lookZoom(look.pinch.z * gap() / look.pinch.d); st.swiped = Date.now(); return; }
      var d = look.drag;
      if (d && d.id === e.pointerId) {
        var dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) > 6) {            /* a partir de 6 px es arrastre y ya no cuenta como clic */
          d.moved = true;
          ui.root.classList.add('is-drag');
          hintHide();
          try { stage.setPointerCapture(e.pointerId); } catch (err) { /* puntero ya liberado */ }
        }
        if (d.moved) {
          var L = lookLimits(look.tz), dt = Math.max(1, e.timeStamp - d.lt);
          look.px = clamp(d.px + DIR * dx, -L.mx, L.mx);
          look.py = clamp(d.py + DIR * dy, -L.my, L.my);
          d.vx = d.vx * 0.6 + (e.clientX - d.lx) / dt * 0.4; d.vy = d.vy * 0.6 + (e.clientY - d.ly) / dt * 0.4;
          d.lx = e.clientX; d.ly = e.clientY; d.lt = e.timeStamp;
          lookKick();
        }
        return;
      }
      /* sin arrastrar, con mouse: parallax muy leve hacia donde está el puntero */
      if (e.pointerType === 'mouse' && !e.buttons && look.W && fine() && !calm()) {
        var r = ui.box.getBoundingClientRect();
        look.par = [-clamp((e.clientX - r.left - r.width / 2) / (r.width / 2), -1, 1) * PARA * look.W,
                    -clamp((e.clientY - r.top - r.height / 2) / (r.height / 2), -1, 1) * PARA * look.H];
        lookKick();
      }
    });
    function end(e) {
      var d = look.drag, wasPinch = !!look.pinch;
      delete look.pts[e.pointerId];
      if (count() < 2) look.pinch = null;
      if (!d || d.id !== e.pointerId) return;
      look.drag = null;
      ui.root.classList.remove('is-drag');
      if (d.moved) {
        st.swiped = Date.now();                              /* el clic que sigue a un arrastre no cuenta */
        if (!wasPinch && e.type === 'pointerup' && e.timeStamp - d.lt < 80) {   /* inercia: sigue un poco en la dirección del gesto */
          var L = lookLimits(look.tz);
          look.px = clamp(look.px + DIR * d.vx * 160, -L.mx, L.mx);
          look.py = clamp(look.py + DIR * d.vy * 160, -L.my, L.my);
        }
        lookKick();
      } else if (e.type === 'pointerup' && e.pointerType !== 'mouse' && !(e.target.closest && e.target.closest('[data-room]'))) {
        var t = look.tap;                                    /* doble toque: vuelve al zoom inicial */
        if (t && e.timeStamp - t.t < 320 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 30) { look.tap = null; lookZoom(BASE); }
        else look.tap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      }
    }
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse' && !look.drag && (look.par[0] || look.par[1])) { look.par = [0, 0]; lookKick(); }
    });
    stage.addEventListener('dblclick', function (e) {
      if (e.target.closest && e.target.closest('[data-room],.intr-nav')) return;
      lookZoom(BASE);
    });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      lookZoom(look.tz * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
    }, { passive: false });
  }

  /* dos flechas por ambiente: al anterior y al siguiente del recorrido (circular), cada una con su etiqueta */
  function renderGos() {
    var unit = st.unit, n = unit.rooms.length, room = unit.rooms[st.i];
    function one(g, to, back) {
      if (!g || n < 2) return '';
      var name = to.name;
      var side = g.lab || (g.x < 26 ? 's' : g.x > 74 ? 'e' : 'c');     /* cerca de un borde, la etiqueta se alinea hacia adentro */
      return '<button class="intr-go" type="button" data-room="' + esc(to.id) + '" data-lab="' + side + '" style="--x:' + g.x + '%;--y:' + g.y + '%;--rot:' + g.rot + 'deg" aria-label="Ir a: ' + esc(name) + '">' +
        '<span class="intr-go-floor">' + CHEVRON + '</span>' +
        '<span class="intr-go-label">' + esc(back ? '← ' + name : name + ' →') + '</span></button>';
    }
    ui.gos.innerHTML = one(room.prev, unit.rooms[(st.i + n - 1) % n], true) + one(room.next, unit.rooms[(st.i + 1) % n], false);
  }

  function renderLists() {
    var unit = st.unit;
    ui.thumbs.innerHTML = unit.rooms.map(function (r, k) {
      return '<button type="button" data-room="' + esc(r.id) + '"><span class="intr-th"><img src="' + esc(src(r.src)) + '" alt="" draggable="false" decoding="async"></span>' +
        '<span class="intr-cap"><i>' + (k < 9 ? '0' : '') + (k + 1) + '</i>' + esc(r.name) + '</span></button>';
    }).join('');
    ui.thumbs.querySelectorAll('img').forEach(function (im) {       /* la miniatura aparece con un fundido cuando termina de cargar */
      var ok = function () { im.classList.add('is-ready'); };
      if (im.complete && im.naturalWidth) ok(); else im.addEventListener('load', ok);
    });
    ui.plan.querySelectorAll('button').forEach(function (b) { b.remove(); });
    ui.planImg.src = src(unit.plan);
    ui.planImg.alt = 'Plano del departamento ' + st.n;
    unit.rooms.forEach(function (r) {
      if (!r.map) return;
      var b = document.createElement('button');
      b.className = 'intr-zone';
      b.type = 'button';
      b.setAttribute('data-room', r.id);
      b.setAttribute('aria-label', r.name + ' en el plano');
      b.style.cssText = 'left:' + r.map[0] + '%;top:' + r.map[1] + '%;width:' + r.map[2] + '%;height:' + r.map[3] + '%';
      ui.plan.appendChild(b);
    });
  }
  function markCurrent() {
    var id = st.unit.rooms[st.i].id;
    ui.root.querySelectorAll('.intr-thumbs button,.intr-zone').forEach(function (b) {
      var on = b.getAttribute('data-room') === id;
      b.classList.toggle('is-on', on);
      if (on) { b.setAttribute('aria-current', 'true'); if (b.scrollIntoView && b.parentNode === ui.thumbs && isSheet()) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      else b.removeAttribute('aria-current');
    });
  }

  /* Cambia de ambiente con un fundido: la foto nueva se carga en la capa de atrás y recién entonces se cruzan.
     Mientras llega la primera se ve el esqueleto en el lugar de la foto; en los cambios, la foto anterior y un indicador. */
  function show(k) {
    var unit = st.unit, n = unit.rooms.length;
    k = ((k % n) + n) % n;
    var same = st.open && k === st.i && ui.imgs[st.front].getAttribute('data-room-id') === unit.rooms[k].id;
    st.i = k;
    var room = unit.rooms[k], tk = ++st.token;
    ui.unit.textContent = 'Departamento ' + st.n;
    ui.room.textContent = room.name;
    ui.count.textContent = (k + 1) + ' / ' + n;
    ui.root.setAttribute('aria-label', 'Interiores del departamento ' + st.n + ': ' + room.name);
    markCurrent();
    setHash('#interior/' + st.n + '/' + room.id);
    if (same) return;
    lookReset(false);                          /* al cambiar de ambiente la vista vuelve al centro, junto con el fundido */

    var cur = ui.imgs[st.front], nxt = ui.imgs[st.front ^ 1], done = false;
    ui.box.classList.add('is-out');
    ui.msg.hidden = true;
    var wait = setTimeout(function () { if (tk === st.token && !done) ui.stage.classList.add('is-loading'); }, 200);
    function swap(failed) {
      if (done || tk !== st.token) return;
      done = true;
      clearTimeout(wait);
      ui.stage.classList.remove('is-loading');
      ui.msg.hidden = !failed;
      nxt.classList.add('is-on');
      cur.classList.remove('is-on');
      st.front ^= 1;
      layout();
      renderGos();
      ui.box.classList.remove('is-out');
      if (ui.box.classList.contains('is-empty')) { ui.box.classList.remove('is-empty'); if (!failed) hintShow(); }
    }
    nxt.alt = room.name + ' del departamento ' + st.n + ' (imagen ilustrativa)';
    nxt.setAttribute('data-room-id', room.id);
    nxt.onload = function () { swap(false); };
    nxt.onerror = function () { swap(true); };
    nxt.src = src(room.src);
    if (nxt.complete && nxt.naturalWidth) swap(false);
  }
  function step(d) { if (st.open) show(st.i + d); }

  function open(n, roomId, fromHash) {
    n = Number(n);
    if (!has(n)) return false;
    var unit = INTERIORES[n];
    var k = roomId ? roomIndex(unit, roomId) : -1;
    if (st.open && st.n === n) {              /* ya abierto en esa unidad (el clic llega por dos escuchas): solo cambia de ambiente si se pidió uno */
      if (k >= 0 && k !== st.i) show(k);
      return true;
    }
    if (!ui) build();
    preload(n);
    var here = location.hash || '';
    st.prev = (fromHash || parseHash(here)) ? '#pisos/' + unit.floor : here;   /* a dónde volver al cerrar */
    st.focus = document.activeElement;
    st.n = n; st.unit = unit; st.i = Math.max(k, 0); st.open = true;
    ui.imgs.forEach(function (im) { im.onload = im.onerror = null; im.classList.remove('is-on'); im.removeAttribute('data-room-id'); im.removeAttribute('src'); });
    ui.box.classList.add('is-empty');
    ui.gos.innerHTML = '';
    setFolded(false);
    lookReset(true);
    ui.root.hidden = false;
    document.documentElement.classList.add('intr-lock');
    renderLists();
    layout();
    show(st.i);
    ui.x.focus();
    emit('alheli:interior-open');             /* el edificio 3D deja de dibujar mientras el visor lo tapa */
    return true;
  }

  function close(keepHash) {
    if (!st.open) return;
    st.open = false;
    st.token++;
    ui.root.hidden = true;
    ui.stage.classList.remove('is-loading');
    if (look.raf) { cancelAnimationFrame(look.raf); look.raf = 0; }
    hintHide();
    lookReset(true);
    document.documentElement.classList.remove('intr-lock');
    if (!keepHash) setHash(st.prev);
    var f = st.focus;
    st.focus = null;
    if (f && f.focus && document.contains(f)) { try { f.focus({ preventScroll: true }); } catch (e) { /* sin foco previo */ } }
    emit('alheli:interior-close');
  }

  /* Teclado, en captura y antes que el resto del sitio: con el visor abierto, Esc lo cierra a él y no a la ficha,
     al panel de Pisos ni al recorrido 3D que quedaron detrás, y las flechas no mueven el edificio. */
  function onKey(e) {
    if (!st.open) return;
    e.stopImmediatePropagation();
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Tab') {                 /* el foco no sale del visor */
      var f = Array.prototype.filter.call(ui.root.querySelectorAll('button'), function (b) { return b.getClientRects().length; });
      if (!f.length) return;
      var a = document.activeElement, first = f[0], last = f[f.length - 1];
      if (!ui.root.contains(a)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }
  }

  /* #interior/3/cocina: abre ese ambiente (al entrar directo o al cambiar el hash); si el hash deja de ser de interiores, cierra */
  function syncFromHash() {
    var p = parseHash(location.hash);
    if (p && has(p.n)) {
      if (!st.open && global.AlheliPisos && typeof global.AlheliPisos.openUnit === 'function') {
        try { global.AlheliPisos.openUnit(p.n); } catch (e) { /* Pisos todavía no está: el visor abre igual */ }
      }
      open(p.n, p.room, true);
    } else if (st.open) close(true);
  }

  /* pasar el mouse o el foco por un botón que abre el visor ya trae sus fotos */
  function warm(e) {
    var b = e.target && e.target.closest && e.target.closest('[data-interior]');
    if (b) preload(Number(b.getAttribute('data-interior')));
  }

  var started = false;
  function init(opts) {
    if (opts && opts.assetBase) base = opts.assetBase;
    if (started) return api;
    started = true;
    global.addEventListener('keydown', onKey, true);
    global.addEventListener('hashchange', syncFromHash);
    document.addEventListener('pointerover', warm, { passive: true });
    document.addEventListener('focusin', warm);
    syncFromHash();
    return api;
  }

  var api = {
    init: init, has: has, preload: preload, roomFor: roomFor,
    isOpen: function () { return st.open; },
    open: function (n, roomId) { return open(n, roomId, false); },
    close: function () { close(); }
  };
  global.AlheliInteriores = api;
})(window);
