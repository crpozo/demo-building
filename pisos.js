/* Sección Pisos — Alhelí Residencias.
   Plantas: láminas del brochure del proyecto (págs. 13-15), recortadas al
   espacio del plano 1125×598 px (15 px ≈ 1 m), el mismo sistema que el modelo 3D.
   Polígonos: ENC + TER de blender/plan_data.json (trazados del plano, no a ojo).
   Datos de áreas y dormitorios: págs. 16-25 del brochure.
   Baños: recuento de sanitarios dibujados en esas mismas láminas (el brochure no imprime un campo "baños").
   Estados: EJEMPLO, editables en PISOS_STATUS_EJEMPLO. No hay precios.
*/
(function (global) {
  'use strict';

  var PLAN_W = 1125, PLAN_H = 598;
  var FLOORS = [
    { id: 'pb', short: 'PB', name: 'Planta baja', img: 'img/pisos/planta-pb.webp', fallback: 'img/pisos/planta-pb.jpg' },
    { id: 'pa', short: 'PA', name: 'Planta alta', img: 'img/pisos/planta-pa.webp', fallback: 'img/pisos/planta-pa.jpg' },
    { id: 'tc', short: 'TC', name: 'Terraza comunal', img: 'img/pisos/planta-tc.webp', fallback: 'img/pisos/planta-tc.jpg' }
  ];
  var PLANTA = { pb: 'Planta baja', pa: 'Planta alta', tc: 'Terraza comunal' };

  /* Áreas y dormitorios: brochure págs. 16-25. bbq solo en dpto. 1 (impreso en su lámina). */
  var UNITS = [{"n":1,"planta":"pb","dorm":2,"banos":2,"cub":116.08,"ext":29.59,"extName":"Patio","bbq":12.42,"pos":[41.3,44.8]},{"n":2,"planta":"pb","dorm":2,"banos":3,"cub":91.02,"ext":38.11,"extName":"Patio","pos":[30.8,20]},{"n":3,"planta":"pb","dorm":2,"banos":3,"cub":104.86,"ext":52.43,"extName":"Patio","pos":[48.7,23.4]},{"n":4,"planta":"pb","dorm":1,"banos":2,"cub":71.05,"ext":80.55,"extName":"Patio","pos":[72.9,19.7]},{"n":5,"planta":"pa","dorm":3,"banos":4,"cub":134.85,"ext":19.91,"extName":"Terrazas","pos":[43.6,40.6]},{"n":6,"planta":"pa","dorm":2,"banos":2,"cub":114.78,"ext":33.38,"extName":"Terrazas","pos":[30.9,59.4]},{"n":7,"planta":"pa","dorm":1,"banos":2,"cub":78.7,"ext":11.69,"extName":"Terraza","pos":[24,25.9]},{"n":8,"planta":"pa","dorm":2,"banos":3,"cub":123.42,"ext":7.74,"extName":"Terraza","pos":[48,25.6]},{"n":9,"planta":"pa","dorm":3,"banos":4,"cub":149.61,"ext":24.55,"extName":"Terraza","pos":[74,26.8]},{"n":10,"planta":"pa","dorm":3,"banos":4,"cub":163.55,"ext":32.58,"extName":"Terraza","pos":[70.7,65.6]}];

  /* Polígonos en coordenadas del plano 1125×598 (ENC interior + TER patio/terraza). */
  var POLYS = {"1":[[[391,210],[566,210],[566,345],[360,345],[360,243],[391,243]],[[566,200],[610,200],[610,345],[566,345]]],"2":[[[208,72],[395,72],[395,172],[360,172],[360,153],[290,153],[290,186],[208,186]]],"3":[[[398,72],[640,72],[640,148],[562,148],[562,185],[500,185],[500,160],[490,160],[490,133],[398,133]]],"4":[[[700,72],[870,72],[870,152],[810,152],[810,180],[765,180],[765,152],[700,152]]],"5":[[[410,231],[531,231],[531,298],[562,298],[562,363],[609,363],[609,444],[562,444],[562,434],[500,434],[500,444],[447,444],[447,298],[410,298]],[[531,231],[562,231],[562,298],[531,298]],[[500,434],[562,434],[562,469],[500,469]]],"6":[[[316,298],[447,298],[447,451],[290,451],[290,350],[316,350]],[[229,350],[290,350],[290,451],[229,451]]],"7":[[[213,95],[396,95],[396,196],[358,196],[358,176],[213,176]],[[185,95],[213,95],[213,176],[185,176]]],"8":[[[398,92],[590,92],[590,118],[649,118],[649,205],[560,205],[560,228],[466,228],[466,150],[398,150]],[[590,92],[649,92],[649,118],[590,118]]],"9":[[[650,90],[876,90],[876,182],[910,182],[910,226],[925,226],[925,303],[836,303],[836,185],[760,185],[760,200],[730,200],[730,158],[650,158]],[[650,158],[730,158],[730,205],[650,205]],[[876,146],[910,146],[910,182],[876,182]]],"10":[[[702,337],[838,337],[838,303],[953,303],[953,368],[957,368],[957,472],[806,472],[806,441],[702,441]],[[702,441],[806,441],[806,480],[702,480]],[[957,368],[975,368],[1003,472],[957,472]]]};

  /* Salón de la terraza comunal: contorno del piso del modelo (shape floor_salon). */
  var TC_POLY = [[316,128],[531,128],[531,411],[316,411]];

  /* ESTADOS DE EJEMPLO. El brochure no publica disponibilidad ni precios.
     Editar solo este objeto: 'disponible' | 'reservado' | 'vendido'. */
  var PISOS_STATUS_EJEMPLO = {
    ejemplo: true,
    etiqueta: 'Estados de ejemplo',
    map: {
      1: 'disponible',
      2: 'disponible',
      3: 'vendido',
      4: 'disponible',
      5: 'reservado',
      6: 'disponible',
      7: 'vendido',
      8: 'disponible',
      9: 'disponible',
      10: 'reservado'
    }
  };

  var MIN_Z = 0.7, MAX_Z = 4;

  function statusOf(n) {
    return (PISOS_STATUS_EJEMPLO.map && PISOS_STATUS_EJEMPLO.map[n]) || 'disponible';
  }
  function m2(v) {
    return v.toFixed(2).replace('.', ',') + ' m²';
  }
  function total(u) {
    return u.cub + u.ext + (u.bbq || 0);
  }
  function polyPath(poly) {
    return poly.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join(' ') + ' Z';
  }
  function floorById(id) {
    return FLOORS.filter(function (f) { return f.id === id; })[0] || FLOORS[0];
  }
  function unitsOn(fl) {
    return UNITS.filter(function (u) { return u.planta === fl; });
  }
  function clsFor(st) {
    return st === 'vendido' ? 'is-vend' : st === 'reservado' ? 'is-res' : 'is-disp';
  }

  function parseHash() {
    var h = (location.hash || '').replace(/^#/, '');
    var m = h.match(/^(?:pisos\/)?(pb|pa|tc)$/);
    if (m) return m[1];
    if (h === 'pisos' || h === '') return null;
    return null;
  }
  function writeHash(fl) {
    /* Solo dentro de la sección Pisos: init() corre en todas las vistas y, sin esto,
       reemplazaba #edificio, #departamentos, etc. por #pisos/pb al cargar la página. */
    if (!/^#pisos?(\/|$)/.test(location.hash || '')) return;
    var next = '#pisos/' + fl;
    if (location.hash !== next) {
      if (history.replaceState) history.replaceState(null, '', next);
      else location.hash = next;
    }
  }

  function build(root, opts) {
    var base = (opts && opts.assetBase) || '';
    function src(p) { return base + p; }

    root.classList.add('pisos-app');
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', 'Planos de pisos de Alhelí Residencias');
    root.innerHTML =
      '<div class="pisos-viewport" tabindex="0">' +
        '<div class="pisos-world"></div>' +
      '</div>' +
      '<aside class="pisos-rail" aria-label="Selector de pisos"></aside>' +
      '<div class="pisos-tools">' +
        '<div class="pisos-zoom">' +
          '<button type="button" data-z="out" aria-label="Alejar">−</button>' +
          '<span class="pct">100%</span>' +
          '<button type="button" data-z="in" aria-label="Acercar">+</button>' +
        '</div>' +
        '<div class="pisos-mini" aria-hidden="true"><img alt=""><div class="box"></div></div>' +
      '</div>' +
      '<aside class="pisos-panel" aria-live="polite"></aside>' +
      '<div class="pisos-note">' + PISOS_STATUS_EJEMPLO.etiqueta + '</div>' +
      '<div class="pisos-lb" hidden><button class="x" type="button" aria-label="Cerrar">×</button><img alt="Plano del departamento"></div>';

    var viewport = root.querySelector('.pisos-viewport');
    var world = root.querySelector('.pisos-world');
    var rail = root.querySelector('.pisos-rail');
    var panel = root.querySelector('.pisos-panel');
    var note = root.querySelector('.pisos-note');
    var mini = root.querySelector('.pisos-mini');
    var miniImg = mini.querySelector('img');
    var miniBox = mini.querySelector('.box');
    var pctEl = root.querySelector('.pisos-zoom .pct');
    var lb = root.querySelector('.pisos-lb');
    var lbImg = lb.querySelector('img');

    rail.innerHTML = FLOORS.map(function (f) {
      return '<button type="button" data-fl="' + f.id + '"><small>' + f.short + '</small><b>' + f.name.replace('Planta ', '').replace(' comunal', '') + '</b></button>';
    }).join('');

    var layers = {};
    FLOORS.forEach(function (f) {
      var el = document.createElement('div');
      el.className = 'pisos-layer';
      el.dataset.fl = f.id;
      el.innerHTML =
        '<img alt="' + f.name + '" src="' + src(f.img) + '">' +
        '<svg class="pisos-svg" viewBox="0 0 ' + PLAN_W + ' ' + PLAN_H + '" preserveAspectRatio="none" aria-hidden="false" role="img">' +
        '<g class="units"></g></svg>';
      var img = el.querySelector('img');
      img.addEventListener('error', function () { if (img.src.indexOf('.webp') !== -1) img.src = src(f.fallback); });
      var g = el.querySelector('.units');
      if (f.id === 'tc') {
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', polyPath(TC_POLY));
        p.setAttribute('class', 'u-hit is-disp');
        p.dataset.tc = '1';
        p.setAttribute('aria-label', 'Terraza comunal');
        g.appendChild(p);
      } else {
        unitsOn(f.id).forEach(function (u) {
          var gg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          gg.setAttribute('class', 'u-group');
          gg.dataset.n = String(u.n);
          (POLYS[u.n] || []).forEach(function (poly) {
            var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', polyPath(poly));
            p.setAttribute('class', 'u-hit ' + clsFor(statusOf(u.n)));
            p.dataset.n = String(u.n);
            p.setAttribute('tabindex', '0');
            p.setAttribute('role', 'button');
            p.setAttribute('aria-label', 'Departamento ' + u.n);
            gg.appendChild(p);
          });
          var chip = document.createElement('div');
          chip.className = 'pisos-chip is-' + statusOf(u.n);
          chip.dataset.n = String(u.n);
          chip.style.left = u.pos[0] + '%';
          chip.style.top = u.pos[1] + '%';
          chip.innerHTML = '<i></i><span>' + u.n + '</span>';
          el.appendChild(chip);
          g.appendChild(gg);
        });
      }
      world.appendChild(el);
      layers[f.id] = el;
    });

    var st = { floor: 'pb', sel: null, scale: 1, x: 0, y: 0, bw: 0, bh: 0, fitted: 1 };
    var fading = false;

    /* Encuadre del edificio (ENC+TER+núcleos, con margen), no de toda la lámina. */
    var FLOOR_FRAME = { pb: [160, 16, 948, 400], pa: [137, 16, 1045, 528], tc: [250, 80, 860, 450] };

    function isNarrow() {
      return viewport.getBoundingClientRect().width < 720;
    }
    function visibleRect() {
      var r = viewport.getBoundingClientRect();
      var left = 0, top = 0, right = r.width, bottom = r.height;
      function cutBottom(el, gap) {
        if (!el) return;
        var b = el.getBoundingClientRect();
        var y = b.top - r.top - (gap || 8);
        if (b.bottom > r.top && y < bottom) bottom = y;
      }
      if (panel.classList.contains('is-open') && isNarrow()) {
        cutBottom(panel, 10);
      } else if (isNarrow()) {
        cutBottom(rail, 10);
      } else if (panel.classList.contains('is-open')) {
        var b = panel.getBoundingClientRect();
        var x = b.right - r.left + 12;
        if (x > left && x < right - 80) left = x;
      }
      if (bottom - top < 80) bottom = top + 80;
      if (right - left < 80) right = left + 80;
      return { x: left, y: top, w: right - left, h: bottom - top };
    }
    function fitSize() {
      var r = viewport.getBoundingClientRect();
      var vw = r.width, vh = r.height;
      if (vw < 8 || vh < 8) return;
      var s = Math.min(vw / PLAN_W, vh / PLAN_H);
      st.bw = PLAN_W * s;
      st.bh = PLAN_H * s;
      world.style.width = st.bw + 'px';
      world.style.height = st.bh + 'px';
    }
    function applyTx() {
      world.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.scale + ')';
      pctEl.textContent = Math.round(st.scale * 100) + '%';
      updateMini();
    }
    function easeTx() {
      world.classList.add('is-easing');
      applyTx();
      clearTimeout(easeTx._t);
      easeTx._t = setTimeout(function () { world.classList.remove('is-easing'); }, 260);
    }
    function bboxOfPolys(polys) {
      var xs = [], ys = [];
      (polys || []).forEach(function (poly) {
        poly.forEach(function (pt) { xs.push(pt[0]); ys.push(pt[1]); });
      });
      if (!xs.length) return [0, 0, PLAN_W, PLAN_H];
      return [Math.min.apply(null, xs) - 10, Math.min.apply(null, ys) - 10, Math.max.apply(null, xs) + 10, Math.max.apply(null, ys) + 10];
    }
    function fitBBox(bbox, animate) {
      if (!st.bw || !bbox) return;
      var vis = visibleRect();
      var boxW = Math.max(40, (bbox[2] - bbox[0]) / PLAN_W * st.bw);
      var boxH = Math.max(40, (bbox[3] - bbox[1]) / PLAN_H * st.bh);
      var s = Math.min(MAX_Z, vis.w / boxW * 0.94, vis.h / boxH * 0.94);
      if (s < 0.7) s = 0.7;
      st.scale = s;
      var sw = boxW * s, sh = boxH * s;
      var ox = (bbox[0] / PLAN_W) * st.bw * s;
      var oy = (bbox[1] / PLAN_H) * st.bh * s;
      st.x = vis.x + (vis.w - sw) / 2 - ox;
      var extraY = vis.h - sh;
      st.y = vis.y + (extraY > 20 ? Math.min(14, extraY * 0.08) : extraY / 2) - oy;
      if (animate) easeTx(); else applyTx();
    }
    function centerFit() {
      fitBBox(FLOOR_FRAME[st.floor] || [0, 0, PLAN_W, PLAN_H], false);
    }
    function clampPan() {
      var vis = visibleRect();
      var w = st.bw * st.scale, h = st.bh * st.scale;
      if (w <= vis.w) st.x = vis.x + (vis.w - w) / 2;
      else st.x = Math.min(vis.x, Math.max(vis.x + vis.w - w, st.x));
      if (h <= vis.h) {
        var extra = vis.h - h;
        var topAlign = isNarrow() || panel.classList.contains('is-open');
        st.y = vis.y + (topAlign && extra > 20 ? Math.min(14, extra * 0.08) : extra / 2);
      } else {
        st.y = Math.min(vis.y, Math.max(vis.y + vis.h - h, st.y));
      }
    }
    function zoomTo(next, cx, cy) {
      var vis = visibleRect();
      cx = cx == null ? vis.x + vis.w / 2 : cx;
      cy = cy == null ? vis.y + vis.h / 2 : cy;
      next = Math.max(MIN_Z, Math.min(MAX_Z, next));
      var k = next / st.scale;
      st.x = cx - (cx - st.x) * k;
      st.y = cy - (cy - st.y) * k;
      st.scale = next;
      clampPan();
      applyTx();
    }
    function ensureVisible(bbox, animate) {
      if (!st.bw || !bbox) return;
      var vis = visibleRect();
      var pad = 16;
      function scr(x, y) {
        return {
          x: st.x + (x / PLAN_W) * st.bw * st.scale,
          y: st.y + (y / PLAN_H) * st.bh * st.scale
        };
      }
      var a = scr(bbox[0], bbox[1]), b = scr(bbox[2], bbox[3]);
      var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
      var x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
      var uw = x1 - x0, uh = y1 - y0;
      if (uw > vis.w - pad * 2 || uh > vis.h - pad * 2) {
        var ns = st.scale * Math.min((vis.w - pad * 2) / Math.max(uw, 1), (vis.h - pad * 2) / Math.max(uh, 1));
        ns = Math.max(MIN_Z, Math.min(st.scale, ns));
        var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        var k = ns / st.scale;
        st.x = cx - (cx - st.x) * k;
        st.y = cy - (cy - st.y) * k;
        st.scale = ns;
        a = scr(bbox[0], bbox[1]); b = scr(bbox[2], bbox[3]);
        x0 = Math.min(a.x, b.x); y0 = Math.min(a.y, b.y);
        x1 = Math.max(a.x, b.x); y1 = Math.max(a.y, b.y);
      }
      var dx = 0, dy = 0;
      if (x0 < vis.x + pad) dx = vis.x + pad - x0;
      if (x1 > vis.x + vis.w - pad) dx = vis.x + vis.w - pad - x1;
      if (x1 - x0 > vis.w - pad * 2) dx = vis.x + vis.w / 2 - (x0 + x1) / 2;
      if (y0 < vis.y + pad) dy = vis.y + pad - y0;
      if (y1 > vis.y + vis.h - pad) dy = vis.y + vis.h - pad - y1;
      if (y1 - y0 > vis.h - pad * 2) dy = vis.y + vis.h / 2 - (y0 + y1) / 2;
      st.x += dx; st.y += dy;
      if (animate) easeTx(); else applyTx();
    }
    function afterPanel(fn) {
      requestAnimationFrame(function () { requestAnimationFrame(fn); });
    }

    function updateMini() {
      var r = viewport.getBoundingClientRect();
      var mw = mini.clientWidth, mh = mini.clientHeight;
      if (!mw) return;
      var sx = mw / (st.bw || 1), sy = mh / (st.bh || 1);
      var left = (-st.x / st.scale) * sx;
      var top = (-st.y / st.scale) * sy;
      var w = (r.width / st.scale) * sx;
      var h = (r.height / st.scale) * sy;
      miniBox.style.left = left + 'px';
      miniBox.style.top = top + 'px';
      miniBox.style.width = w + 'px';
      miniBox.style.height = h + 'px';
    }

    function preload(id) {
      var order = ['pb', 'pa', 'tc'];
      var i = order.indexOf(id);
      [id, order[i - 1], order[i + 1]].forEach(function (k) {
        if (!k) return;
        var f = floorById(k);
        var im = new Image();
        im.src = src(f.img);
      });
    }

    function setFloor(id, fromHash) {
      if (!floorById(id)) id = 'pb';
      if (id === st.floor && layers[id].classList.contains('is-on')) {
        if (!fromHash) writeHash(id);
        return;
      }
      preload(id);
      var prev = st.floor;
      st.floor = id;
      st.sel = null;
      closePanel();
      rail.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('is-on', b.dataset.fl === id);
      });
      var incoming = layers[id];
      var outgoing = layers[prev];
      if (outgoing && outgoing !== incoming && outgoing.classList.contains('is-on')) {
        incoming.classList.add('is-on');
        outgoing.classList.remove('is-on');
      } else {
        FLOORS.forEach(function (f) { layers[f.id].classList.toggle('is-on', f.id === id); });
      }
      miniImg.src = src(floorById(id).img);
      miniImg.onerror = function () { miniImg.src = src(floorById(id).fallback); };
      if (!fromHash) writeHash(id);
      afterPanel(function () { fitBBox(FLOOR_FRAME[id] || [0, 0, PLAN_W, PLAN_H], true); });
    }

    function openUnit(u) {
      st.sel = u.n;
      root.querySelectorAll('.u-hit').forEach(function (p) {
        p.classList.toggle('is-on', Number(p.dataset.n) === u.n);
      });
      root.querySelectorAll('.pisos-chip').forEach(function (c) {
        c.classList.toggle('is-on', Number(c.dataset.n) === u.n);
      });
      var stt = statusOf(u.n);
      /* «Ver interior» solo si el visor de interiores tiene fotos de esta unidad */
      var hasInt = !!(global.AlheliInteriores && global.AlheliInteriores.has && global.AlheliInteriores.has(u.n));
      panel.innerHTML =
        '<div class="row"><span class="pisos-ejemplo">' + PISOS_STATUS_EJEMPLO.etiqueta + '</span><button class="x" type="button" aria-label="Cerrar">×</button></div>' +
        '<div class="pisos-thumb"><img src="' + src('img/pisos/u' + u.n + '.jpg') + '" alt="Plano del departamento ' + u.n + '"></div>' +
        '<div class="row"><h3>Departamento ' + u.n + '</h3><span class="pisos-badge ' + stt + '">' + stt + '</span></div>' +
        '<div class="spec">' +
          '<div><span>Dormitorios</span><b>' + u.dorm + '</b></div>' +
          (u.banos ? '<div><span>Baños</span><b>' + u.banos + '</b></div>' : '') +
          '<div><span>Piso</span><b>' + PLANTA[u.planta] + '</b></div>' +
          '<div><span>Área cubierta</span><b>' + m2(u.cub) + '</b></div>' +
          '<div><span>' + u.extName + '</span><b>' + m2(u.ext) + '</b></div>' +
          (u.bbq ? '<div><span>BBQ</span><b>' + m2(u.bbq) + '</b></div>' : '') +
          '<div><span>Total</span><b>' + m2(total(u)) + '</b></div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn ghost" type="button" data-plano="' + u.n + '">Ver plano</button>' +
          '<a class="btn ' + (hasInt ? 'ghost' : 'gold') + '" href="#edificio" data-walk="' + u.n + '">Recorrido 3D</a>' +
          (hasInt ? '<button class="btn gold" type="button" data-interior="' + u.n + '">Ver interior</button>' : '') +
        '</div>';
      panel.classList.add('is-open');
      panel.querySelector('.x').onclick = closePanel;
      afterPanel(function () { ensureVisible(bboxOfPolys(POLYS[u.n]), true); });
    }
    function openTerraza() {
      st.sel = 'tc';
      panel.innerHTML =
        '<div class="row"><span class="pisos-ejemplo">Áreas comunes</span><button class="x" type="button" aria-label="Cerrar">×</button></div>' +
        '<div class="pisos-thumb"><img src="' + src('img/r-terraza.jpg') + '" alt="Terraza comunal"></div>' +
        '<div class="row"><h3>Terraza comunal</h3></div>' +
        '<p style="margin:0;font-size:.9rem;color:var(--muted,#6f6472)">Salón con cocina, baños y terraza abierta sobre la cubierta, con jardineras perimetrales. Un espacio compartido para los diez departamentos.</p>' +
        '<div class="actions">' +
          '<a class="btn gold" href="#edificio">Ver en el edificio 3D</a>' +
        '</div>';
      panel.classList.add('is-open');
      panel.querySelector('.x').onclick = closePanel;
      afterPanel(function () { ensureVisible(bboxOfPolys([TC_POLY]), true); });
    }
    function closePanel() {
      st.sel = null;
      panel.classList.remove('is-open');
      panel.innerHTML = '';
      root.querySelectorAll('.u-hit.is-on,.pisos-chip.is-on').forEach(function (el) { el.classList.remove('is-on'); });
      afterPanel(function () { clampPan(); easeTx(); });
    }

    function openPlano(n) {
      lbImg.src = src('img/pisos/u' + n + '.jpg');
      lbImg.alt = 'Plano del departamento ' + n;
      lb.hidden = false;
      lb.classList.add('is-open');
    }
    function closePlano() {
      lb.classList.remove('is-open');
      lb.hidden = true;
    }

    world.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.pisos-chip');
      var hit = e.target.closest && e.target.closest('.u-hit');
      if (chip && chip.dataset.n) {
        e.stopPropagation();
        var u = UNITS.filter(function (x) { return x.n === Number(chip.dataset.n); })[0];
        if (u) openUnit(u);
        return;
      }
      if (!hit) { closePanel(); return; }
      e.stopPropagation();
      if (hit.dataset.tc) { openTerraza(); return; }
      var u = UNITS.filter(function (x) { return x.n === Number(hit.dataset.n); })[0];
      if (u) openUnit(u);
    });
    world.addEventListener('pointermove', function (e) {
      var t = e.target.closest && (e.target.closest('.u-hit') || e.target.closest('.pisos-chip'));
      var n = t && (t.dataset.n || (t.dataset.tc ? 'tc' : ''));
      root.querySelectorAll('.u-hit.is-hover').forEach(function (p) { p.classList.remove('is-hover'); });
      if (n === 'tc') {
        var p = root.querySelector('.u-hit[data-tc]'); if (p) p.classList.add('is-hover');
      } else if (n) {
        root.querySelectorAll('.u-hit[data-n="' + n + '"]').forEach(function (p) { p.classList.add('is-hover'); });
      }
    });
    world.addEventListener('pointerleave', function () {
      root.querySelectorAll('.u-hit.is-hover').forEach(function (p) { p.classList.remove('is-hover'); });
    });
    world.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var hit = e.target.closest && e.target.closest('.u-hit');
      if (!hit) return;
      e.preventDefault();
      if (hit.dataset.tc) openTerraza();
      else {
        var u = UNITS.filter(function (x) { return x.n === Number(hit.dataset.n); })[0];
        if (u) openUnit(u);
      }
    });

    panel.addEventListener('click', function (e) {
      var pl = e.target.closest && e.target.closest('[data-plano]');
      if (pl) { e.preventDefault(); openPlano(Number(pl.dataset.plano)); return; }
      var it = e.target.closest && e.target.closest('[data-interior]');
      if (it) { e.preventDefault(); if (global.AlheliInteriores) global.AlheliInteriores.open(Number(it.dataset.interior)); return; }
      var wk = e.target.closest && e.target.closest('[data-walk]');
      if (wk) {
        var n = Number(wk.dataset.walk);
        /* El clic delegado del sitio ([data-walk]) también dispara walk3D.
           Forzamos el hash por si el <a> no llega a cambiarlo. */
        if (location.hash !== '#edificio') location.hash = '#edificio';
        setTimeout(function () {
          if (typeof global.walk3D === 'function') global.walk3D(n);
          else if (typeof global.visit3D === 'function') global.visit3D(n);
        }, 120);
      }
    });
    lb.addEventListener('click', function (e) {
      if (e.target === lb || e.target.closest('.x')) closePlano();
    });

    rail.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b && b.dataset.fl) setFloor(b.dataset.fl);
    });
    root.querySelector('.pisos-zoom').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.z === 'in') zoomTo(st.scale * 1.25);
      if (b.dataset.z === 'out') {
        if (st.scale <= 1.02) centerFit();
        else zoomTo(st.scale / 1.25);
      }
    });

    /* Pan / zoom (ratón y táctil) */
    var drag = null, pins = new Map();
    function pt(e) { return { x: e.clientX, y: e.clientY }; }
    viewport.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.pisos-rail,.pisos-tools,.pisos-panel,.pisos-lb')) return;
      /* La captura del puntero se toma recién al arrastrar (ver pointermove): si se captura aquí,
         Chrome entrega el click al viewport y no al polígono/chip, y el depto nunca se abre. */
      pins.set(e.pointerId, pt(e));
      if (pins.size === 1) {
        drag = { x: e.clientX - st.x, y: e.clientY - st.y, sx: e.clientX, sy: e.clientY, moved: false };
        viewport.classList.add('is-panning');
      }
    });
    viewport.addEventListener('pointermove', function (e) {
      if (pins.size === 2) {
        var arr = Array.from(pins.entries());
        var a0 = arr[0][1], b0 = arr[1][1];
        pins.set(e.pointerId, pt(e));
        arr = Array.from(pins.values());
        var a1 = arr[0], b1 = arr[1];
        var d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
        var d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1;
        var cx = (a1.x + b1.x) / 2 - viewport.getBoundingClientRect().left;
        var cy = (a1.y + b1.y) / 2 - viewport.getBoundingClientRect().top;
        zoomTo(st.scale * (d1 / d0), cx, cy);
        drag = null;
        return;
      }
      if (!drag) return;
      var nx = e.clientX - drag.x, ny = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) {
        drag.moved = true;
        try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
      }
      st.x = nx; st.y = ny;
      clampPan();
      applyTx();
    });
    function endPtr(e) {
      pins.delete(e.pointerId);
      if (pins.size === 0) {
        viewport.classList.remove('is-panning');
        drag = null;
      }
    }
    viewport.addEventListener('pointerup', endPtr);
    viewport.addEventListener('pointercancel', endPtr);
    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = viewport.getBoundingClientRect();
      var factor = e.deltaY > 0 ? 1 / 1.12 : 1.12;
      zoomTo(st.scale * factor, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    mini.addEventListener('click', function (e) {
      var r = mini.getBoundingClientRect();
      var vr = viewport.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width;
      var py = (e.clientY - r.top) / r.height;
      st.x = vr.width / 2 - px * st.bw * st.scale;
      st.y = vr.height / 2 - py * st.bh * st.scale;
      clampPan();
      applyTx();
    });

    document.addEventListener('keydown', function onEsc(e) {
      if (!root.offsetParent && !root.getClientRects().length) return;
      if (e.key === 'Escape') {
        if (lb.classList.contains('is-open')) closePlano();
        else closePanel();
      }
    });

    var ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(function () {
      var prevW = st.bw, prevH = st.bh;
      fitSize();
      if (prevW) {
        st.x *= st.bw / prevW;
        st.y *= st.bh / prevH;
        clampPan();
        applyTx();
      } else {
        centerFit();
      }
    }) : null;
    if (ro) ro.observe(viewport);

    function syncFromHash() {
      var fl = parseHash() || st.floor || 'pb';
      setFloor(fl, true);
      fitSize();
      if (st.bw) fitBBox(FLOOR_FRAME[st.floor] || [0, 0, PLAN_W, PLAN_H], false);
    }

    fitSize();
    var start = parseHash() || (opts && opts.floor) || 'pb';
    setFloor(start, !!(opts && opts.skipHash));
    centerFit();
    preload(start);

    return {
      setFloor: setFloor,
      syncFromHash: syncFromHash,
      openUnit: function (n) {
        var u = UNITS.filter(function (x) { return x.n === n; })[0];
        if (!u) return;
        if (st.floor !== u.planta) setFloor(u.planta);
        openUnit(u);
      },
      closePanel: closePanel,
      status: PISOS_STATUS_EJEMPLO
    };
  }

  var api = null;
  function init(opts) {
    opts = opts || {};
    var el = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : (opts.mount || document.getElementById('pisosApp'));
    if (!el) return null;
    api = build(el, opts);
    global.AlheliPisos = Object.assign(global.AlheliPisos || {}, api);
    return api;
  }

  global.AlheliPisos = {
    init: init,
    syncFromHash: function () { if (api) api.syncFromHash(); },
    openUnit: function (n) { if (api) api.openUnit(n); },
    STATUS_EJEMPLO: PISOS_STATUS_EJEMPLO,
    UNITS: UNITS
  };

  if (document.currentScript && document.currentScript.getAttribute('data-autostart') === 'true') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
    else init();
  }
})(window);
