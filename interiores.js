/* Alhelí — visor de interiores: fotos por ambiente, a pantalla completa, con paso de un ambiente al siguiente.
   Todo sale del diccionario INTERIORES: una unidad tiene botón «Ver interior» y visor solo si está ahí.
   Para sumar otro departamento alcanza con agregar su entrada y sus imágenes. */
(function (global) {
  'use strict';

  /* Por ambiente:
       id, name   nombre del ambiente (id va en el hash: #interior/3/sala)
       src, w, h  foto y su tamaño en px
       map        caja del ambiente en el plano de la unidad: [x, y, ancho, alto] en % del jpg
       go         flechas en el piso: a qué ambiente llevan y dónde apoyan, en % de la foto (rot 0 = hacia el fondo, 90 = a la derecha)
     El recorrido sigue el orden de la lista y del último vuelve al primero. */
  var INTERIORES = {
    3: {
      floor: 'pb',
      plan: 'img/pisos/u3.jpg',
      rooms: [
        { id: 'sala', name: 'Sala', src: 'img/interiores/d3/sala.webp', w: 1920, h: 1194,
          map: [55.3, 32.9, 12.7, 32.9],
          go: [{ to: 'comedor', x: 87, y: 88.5, rot: 85 }] },
        { id: 'comedor', name: 'Comedor', src: 'img/interiores/d3/comedor.webp', w: 1920, h: 1200,
          map: [68.0, 32.9, 11.6, 32.9],
          go: [{ to: 'sala', x: 18, y: 95, rot: -90 }, { to: 'cocina', x: 79, y: 94.5, rot: 80 }] },
        { id: 'cocina', name: 'Cocina', src: 'img/interiores/d3/cocina.webp', w: 1920, h: 1200,
          map: [79.6, 30.9, 16.4, 41.5],
          go: [{ to: 'comedor', x: 22, y: 90, rot: -85 }] },
        { id: 'dormitorio-master', name: 'Dormitorio máster', src: 'img/interiores/d3/dormitorio-master.webp', w: 1920, h: 1200,
          map: [13.3, 31.3, 16.0, 33.7],
          go: [] }   /* la cama ocupa casi toda la foto: sin flecha en el piso */
      ]
    }
  };

  var FADE = 300;
  var base = '';
  var ui = null;                 /* nodos del visor; se arma la primera vez que se abre */
  var st = { open: false, n: null, unit: null, i: 0, front: 0, token: 0, prev: null, focus: null, swiped: 0 };

  function src(p) { return base + p; }
  function has(n) { return Object.prototype.hasOwnProperty.call(INTERIORES, String(n)); }
  function roomIndex(unit, id) {
    for (var k = 0; k < unit.rooms.length; k++) if (unit.rooms[k].id === id) return k;
    return -1;
  }
  function parseHash(h) {
    var m = /^#interior\/(\d+)(?:\/([\w-]+))?\/?$/.exec(h || '');
    return m ? { n: Number(m[1]), room: m[2] || null } : null;
  }
  function setHash(h) {
    try { history.replaceState(null, '', h || (location.pathname + location.search)); } catch (e) { /* file:// u otros: el visor funciona igual sin hash */ }
  }
  function el(tag, cls, attrs) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    for (var k in attrs || {}) d.setAttribute(k, attrs[k]);
    return d;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* flecha del piso: dos chevrons que apuntan hacia arriba; el CSS los acuesta sobre el suelo y los gira hacia el destino */
  var CHEVRON =
    '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<g class="c2"><path class="sh" d="M22 86 50 62 78 86"/><path class="ln" d="M22 86 50 62 78 86"/></g>' +
      '<g class="c1"><path class="sh" d="M22 54 50 30 78 54"/><path class="ln" d="M22 54 50 30 78 54"/></g>' +
    '</svg>';

  function build() {
    var root = el('div', 'intr', { role: 'dialog', 'aria-modal': 'true', hidden: '' });
    root.innerHTML =
      '<div class="intr-stage">' +
        '<img class="intr-img" alt="" draggable="false" decoding="async">' +
        '<img class="intr-img" alt="" draggable="false" decoding="async">' +
        '<div class="intr-box">' +
          '<span class="intr-tag">Imagen ilustrativa</span>' +
          '<div class="intr-gos"></div>' +
        '</div>' +
        '<p class="intr-msg" hidden>No se pudo cargar la imagen de este ambiente.</p>' +
      '</div>' +
      '<header class="intr-head">' +
        '<div class="intr-title" aria-live="polite"><p class="intr-unit"></p><h2 class="intr-room"></h2></div>' +
        '<span class="intr-count"></span>' +
        '<button class="intr-x" type="button" aria-label="Cerrar el visor de interiores">×</button>' +
      '</header>' +
      '<button class="intr-nav intr-prev" type="button" aria-label="Ambiente anterior"><span aria-hidden="true">‹</span></button>' +
      '<button class="intr-nav intr-next" type="button" aria-label="Ambiente siguiente"><span aria-hidden="true">›</span></button>' +
      '<div class="intr-dots" role="group" aria-label="Ambientes"></div>' +
      '<div class="intr-map"><p class="intr-eyebrow">En el plano</p><div class="intr-plan"><img alt="" draggable="false"></div></div>' +
      '<div class="intr-thumbs" role="group" aria-label="Ambientes"></div>' +
      '<p class="intr-hint">← → cambia de ambiente · Esc cierra</p>';
    document.body.appendChild(root);

    var q = function (s) { return root.querySelector(s); };
    ui = {
      root: root, stage: q('.intr-stage'), imgs: root.querySelectorAll('.intr-img'), box: q('.intr-box'), gos: q('.intr-gos'), msg: q('.intr-msg'),
      unit: q('.intr-unit'), room: q('.intr-room'), count: q('.intr-count'), x: q('.intr-x'),
      prev: q('.intr-prev'), next: q('.intr-next'), dots: q('.intr-dots'), plan: q('.intr-plan'), planImg: q('.intr-plan img'), thumbs: q('.intr-thumbs')
    };

    ui.x.addEventListener('click', function () { close(); });
    ui.prev.addEventListener('click', function () { step(-1); });
    ui.next.addEventListener('click', function () { step(1); });

    /* miniaturas, puntos, plano y flechas del piso: todos llevan data-room */
    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-room]');
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

    /* deslizar a izquierda o derecha */
    var sw = null;
    ui.stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      sw = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    ui.stage.addEventListener('pointerup', function (e) {
      if (!sw || sw.id !== e.pointerId) return;
      var dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      sw = null;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.4) { st.swiped = Date.now(); step(dx < 0 ? 1 : -1); }
    });
    ui.stage.addEventListener('pointercancel', function () { sw = null; });

    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(ui.stage);
    global.addEventListener('resize', layout);
  }

  /* La foto va con object-fit: contain, así que no ocupa todo el escenario. Las flechas del piso y la etiqueta se anclan
     a esta caja, que es el recuadro real de la foto, y no a la ventana: si no, en un móvil quedarían en la banda oscura. */
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
  }

  function goLabel(g, name) {
    var r = ((g.rot % 360) + 540) % 360 - 180;            /* -180..180 */
    if (Math.abs(r) < 30) return '↑ ' + name;
    return r < 0 ? '← ' + name : name + ' →';
  }
  function renderGos() {
    var unit = st.unit, room = unit.rooms[st.i];
    ui.gos.innerHTML = (room.go || []).map(function (g) {
      var k = roomIndex(unit, g.to);
      if (k < 0) return '';
      var name = unit.rooms[k].name;
      return '<button class="intr-go" type="button" data-room="' + esc(g.to) + '" style="--x:' + g.x + '%;--y:' + g.y + '%;--rot:' + g.rot + 'deg" aria-label="Ir a: ' + esc(name) + '">' +
        '<span class="intr-go-floor">' + CHEVRON + '</span>' +
        '<span class="intr-go-label">' + esc(goLabel(g, name)) + '</span></button>';
    }).join('');
  }

  function renderLists() {
    var unit = st.unit;
    ui.thumbs.innerHTML = unit.rooms.map(function (r, k) {
      return '<button type="button" data-room="' + esc(r.id) + '"><img src="' + esc(src(r.src)) + '" alt="" draggable="false">' +
        '<span><i>' + (k < 9 ? '0' : '') + (k + 1) + '</i>' + esc(r.name) + '</span></button>';
    }).join('');
    ui.dots.innerHTML = unit.rooms.map(function (r) {
      return '<button type="button" data-room="' + esc(r.id) + '" aria-label="' + esc(r.name) + '"><i></i></button>';
    }).join('');
    ui.plan.querySelectorAll('button').forEach(function (b) { b.remove(); });
    ui.planImg.src = src(unit.plan);
    ui.planImg.alt = 'Plano del departamento ' + st.n;
    unit.rooms.forEach(function (r) {
      if (!r.map) return;
      var b = el('button', 'intr-zone', { type: 'button', 'data-room': r.id, 'aria-label': r.name + ' en el plano' });
      b.style.cssText = 'left:' + r.map[0] + '%;top:' + r.map[1] + '%;width:' + r.map[2] + '%;height:' + r.map[3] + '%';
      ui.plan.appendChild(b);
    });
  }
  function markCurrent() {
    var id = st.unit.rooms[st.i].id;
    ui.root.querySelectorAll('.intr-thumbs button,.intr-dots button,.intr-zone').forEach(function (b) {
      var on = b.getAttribute('data-room') === id;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  /* cambia de ambiente con un fundido: la foto nueva se carga en la capa de atrás y recién entonces se cruzan */
  function show(k, instant) {
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

    var cur = ui.imgs[st.front], nxt = ui.imgs[st.front ^ 1], done = false;
    ui.box.classList.add('is-out');
    ui.msg.hidden = true;
    var wait = setTimeout(function () { if (tk === st.token && !done) ui.stage.classList.add('is-loading'); }, 250);
    function swap(failed) {
      if (done || tk !== st.token) return;
      done = true;
      clearTimeout(wait);
      ui.stage.classList.remove('is-loading');
      ui.msg.hidden = !failed;
      nxt.classList.toggle('is-instant', !!instant);
      cur.classList.toggle('is-instant', !!instant);
      nxt.classList.add('is-on');
      cur.classList.remove('is-on');
      st.front ^= 1;
      layout();
      renderGos();
      ui.box.classList.remove('is-out');
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
    var here = location.hash || '';
    st.prev = (fromHash || parseHash(here)) ? '#pisos/' + unit.floor : here;   /* a dónde volver al cerrar */
    st.focus = document.activeElement;
    st.n = n; st.unit = unit; st.i = Math.max(k, 0); st.open = true;
    ui.imgs.forEach(function (im) { im.classList.remove('is-on'); im.removeAttribute('data-room-id'); });
    ui.root.hidden = false;
    document.documentElement.classList.add('intr-lock');
    renderLists();
    ui.gos.innerHTML = '';
    layout();
    show(st.i, true);
    unit.rooms.forEach(function (r) { var im = new Image(); im.src = src(r.src); });   /* el resto, para que el cambio sea inmediato */
    ui.x.focus();
    return true;
  }

  function close(keepHash) {
    if (!st.open) return;
    st.open = false;
    st.token++;
    ui.root.hidden = true;
    ui.stage.classList.remove('is-loading');
    document.documentElement.classList.remove('intr-lock');
    if (!keepHash) setHash(st.prev);
    var f = st.focus;
    st.focus = null;
    if (f && f.focus && document.contains(f)) { try { f.focus({ preventScroll: true }); } catch (e) { /* sin foco previo */ } }
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

  var started = false;
  function init(opts) {
    if (opts && opts.assetBase) base = opts.assetBase;
    if (started) return api;
    started = true;
    global.addEventListener('keydown', onKey, true);
    global.addEventListener('hashchange', syncFromHash);
    syncFromHash();
    return api;
  }

  var api = { init: init, has: has, open: function (n, roomId) { return open(n, roomId, false); }, close: function () { close(); } };
  global.AlheliInteriores = api;
})(window);
