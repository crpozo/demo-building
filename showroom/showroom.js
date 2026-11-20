(() => {
  'use strict';
  const D = window.ALHELI;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const VB = { w: 1600, h: 900 };           // marco de los renders 16:9
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = () => innerWidth <= 1100;
  const imgUrl = (name) => `assets/img/${name}${small() ? '-sm' : ''}.jpg`;
  const clipUrl = (src) => (small() ? src.replace(/\.mp4$/, '-sm.mp4') : src);

  /* Los clips se descargan completos antes de usarlos (como blob), así la transición arranca al instante. */
  const clips = new Map();
  function loadClip(src) {
    const url = clipUrl(src);
    if (!clips.has(url)) {
      clips.set(url, fetch(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
        .then((b) => URL.createObjectURL(b))
        .catch(() => { clips.delete(url); return null; }));
    }
    return clips.get(url);
  }
  const status = (n) => D.STATUS[n] || 'disponible';
  const unitBy = (n) => D.UNITS.find((u) => u.n === n);
  const m2 = (v) => v.toFixed(2).replace('.', ',') + ' m²';
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
  const STATUS_TXT = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' };

  const sr = $('sr'), still = $('still'), stillNext = $('stillNext'), clip = $('clip');
  const zones = $('zones'), pins = $('pins'), tip = $('tip');
  const labelsLayer = pins;

  let cur = 0;
  let moving = false;
  let unitSel = null;

  /* ---------- utilidades ---------- */
  const decoded = new Map();
  function loadImage(src) {
    if (decoded.has(src)) return decoded.get(src);
    const p = new Promise((resolve) => {
      const im = new Image();
      const done = () => resolve(src);
      // decode() puede quedar en espera si la pestaña está en segundo plano: nunca bloquea más de 400 ms.
      im.onload = () => Promise.race([im.decode ? im.decode().catch(() => {}) : null, new Promise((r) => setTimeout(r, 400))]).then(done);
      im.onerror = done;
      setTimeout(done, 8000);
      im.src = src;
    });
    decoded.set(src, p);
    return p;
  }
  // Espera a que el <img> visible esté decodificado, con tope para pestañas en segundo plano.
  const settle = (img) => Promise.race([img.decode ? img.decode().catch(() => {}) : null, new Promise((r) => setTimeout(r, 400))]);
  function el(tag, attrs = {}, parent) {
    const isSvg = ['svg', 'polygon', 'text', 'g'].includes(tag);
    const node = isSvg ? document.createElementNS(NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v);
    }
    if (parent) parent.appendChild(node);
    return node;
  }
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.classList.add('show');
    tip.setAttribute('aria-hidden', 'false');
  }
  function hideTip() { tip.classList.remove('show'); tip.setAttribute('aria-hidden', 'true'); }

  /* posición en pantalla de un punto (en %) de un render con object-fit: cover */
  function coverPoint(px, py) {
    const W = innerWidth, H = innerHeight;
    const s = Math.max(W / VB.w, H / VB.h);
    return [(W - VB.w * s) / 2 + (px / 100) * VB.w * s, (H - VB.h * s) / 2 + (py / 100) * VB.h * s];
  }

  /* ---------- vista ---------- */
  function neighbour(dir) {
    const stop = D.STOPS[cur];
    if (stop.ring) {
      const ring = D.STOPS.map((s, i) => (s.ring === stop.ring ? i : -1)).filter((i) => i >= 0);
      return ring[(ring.indexOf(cur) + dir + ring.length) % ring.length];
    }
    const walk = D.STOPS.map((s, i) => (s.ring ? -1 : i)).filter((i) => i >= 0);
    const k = walk.indexOf(cur) + dir;
    if (k < 0) return D.STOPS.findIndex((s) => s.ring);
    return k < walk.length ? walk[k] : -1;
  }
  const step = (dir) => { const i = neighbour(dir); if (i >= 0) goTo(i); };

  function renderStop() {
    const stop = D.STOPS[cur];
    $('capKind').textContent = stop.kind;
    $('capName').textContent = stop.name;
    $('capHint').textContent = stop.units ? 'Toque un departamento o gire alrededor del edificio con las flechas.'
      : stop.floors ? 'Toque una planta del edificio para ver sus departamentos.' : 'Use las flechas o los puntos para recorrer el proyecto.';
    $('prevBtn').disabled = neighbour(-1) < 0;
    $('nextBtn').disabled = neighbour(1) < 0;
    document.querySelectorAll('.stop').forEach((b, i) => {
      b.classList.toggle('on', i === cur);
      b.setAttribute('aria-current', i === cur ? 'true' : 'false');
    });

    zones.replaceChildren();
    (stop.floors || []).forEach((f) => {
      const units = D.UNITS.filter((u) => u.planta === f.planta);
      const free = units.filter((u) => status(u.n) === 'disponible').length;
      const poly = el('polygon', {
        class: 'fz', tabindex: '0', role: 'button',
        'aria-label': `${f.label}: ${units.length} departamentos, ${free} disponibles`,
        points: f.pts.map(([x, y]) => `${(x / 100) * VB.w},${(y / 100) * VB.h}`).join(' ')
      }, zones);
      const label = `<b>${f.label}</b><br>${units.length} departamentos · ${free} disponibles`;
      poly.addEventListener('pointermove', (e) => showTip(label, e.clientX, e.clientY));
      poly.addEventListener('pointerleave', hideTip);
      poly.addEventListener('focus', () => { const r = poly.getBoundingClientRect(); showTip(label, r.left + r.width / 2, r.top); });
      poly.addEventListener('blur', hideTip);
      const open = () => { hideTip(); showEnterCard(f); };
      poly.addEventListener('click', open);
      poly.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    labelsLayer.replaceChildren();
    Object.entries(stop.units || {}).forEach(([n, list]) => {
      n = +n;
      const u = unitBy(n), st = status(n);
      const g = el('g', { class: `uz st-${st}`, tabindex: '0', role: 'button', 'aria-label': `Departamento ${n}, ${dormTxt(u.dorm)}, ${STATUS_TXT[st]}` }, zones);
      g.dataset.n = n;
      list.forEach((pts) => el('polygon', { points: pts.map(([x, y]) => `${(x / 100) * VB.w},${(y / 100) * VB.h}`).join(' ') }, g));
      const big = list[0];
      const [cx, cy] = (stop.labels && stop.labels[n]) || areaCentroid(big);
      const lb = el('button', { class: 'uz-label', type: 'button', tabindex: '-1', 'aria-hidden': 'true', html: `<i class="st-${st}"></i>${n}` }, labelsLayer);
      lb.dataset.n = n; lb.dataset.x = cx; lb.dataset.y = cy;
      const tipTxt = `<b>Departamento ${n}</b><br>${D.PLANTAS[u.planta].name} · ${dormTxt(u.dorm)}<br>${STATUS_TXT[st]}`;
      g.addEventListener('pointermove', (e) => showTip(tipTxt, e.clientX, e.clientY));
      g.addEventListener('pointerleave', hideTip);
      lb.addEventListener('pointerenter', () => g.classList.add('hover'));
      lb.addEventListener('pointerleave', () => g.classList.remove('hover'));
      const open = () => { hideTip(); showStageUnit(n); };
      g.addEventListener('click', open);
      lb.addEventListener('click', open);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    if (stop.floors && !sessionStorage.getItem('alheli:hinted')) {
      zones.classList.add('hint');
      try { sessionStorage.setItem('alheli:hinted', '1'); } catch (_) { /* sin almacenamiento */ }
    } else zones.classList.remove('hint');

    pins.querySelectorAll('.pin').forEach((e) => e.remove());
    (stop.pins || []).forEach((p) => {
      const b = el('button', { class: 'pin', type: 'button', text: p.label }, pins);
      b.dataset.x = p.x; b.dataset.y = p.y;
      b.addEventListener('click', () => {
        if (p.go) goTo(D.STOPS.findIndex((s) => s.id === p.go));
        else if (p.plan) enterFloor(p.plan);
        else if (p.interior) openViewer([p.interior], p.interior);
      });
    });
    placePins();
    syncUrl();
  }
  function placePins() {
    pins.querySelectorAll('.pin, .uz-label').forEach((b) => {
      const [x, y] = coverPoint(+b.dataset.x, +b.dataset.y);
      b.style.left = x + 'px';
      b.style.top = y + 'px';
    });
  }

  async function goTo(index) {
    if (moving || index === cur || index < 0 || index >= D.STOPS.length) return;
    moving = true;
    sr.classList.add('moving');
    hideTip();
    const from = D.STOPS[cur], to = D.STOPS[index];
    const nextSrc = imgUrl(to.img);
    const clipSrc = D.TRANSITIONS[`${from.id}>${to.id}`] || null;
    const imgReady = loadImage(nextSrc);

    let played = false;
    if (clipSrc && !reduced) played = await playClip(clipSrc, imgReady, nextSrc);
    $('cardSheet').hidden = true;
    if (!played) await crossfade(nextSrc, index > cur);

    cur = index;
    renderStop();
    preloadNeighbours();
    sr.classList.remove('moving');
    moving = false;
  }

  /* Transición con video: el primer cuadro coincide con la vista actual y el último con la siguiente. */
  async function playClip(src, imgReady, nextSrc) {
    try {
      // Si el clip todavía no terminó de descargarse en 8 s, se usa el fundido.
      const url = await Promise.race([loadClip(src), new Promise((r) => setTimeout(() => r(null), 8000))]);
      if (!url) return false;
      clip.src = url;
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 4000);
        clip.oncanplay = () => { clearTimeout(t); resolve(); };
        clip.onerror = () => { clearTimeout(t); reject(new Error('video')); };
        clip.load();
      });
      clip.currentTime = 0;
      await clip.play();
      // Mostrar el video recién cuando pintó su primer cuadro, para no ver un fotograma negro.
      await new Promise((resolve) => {
        if (clip.requestVideoFrameCallback) clip.requestVideoFrameCallback(() => resolve());
        else requestAnimationFrame(() => requestAnimationFrame(resolve));
        setTimeout(resolve, 300);
      });
      clip.classList.add('show');
      await new Promise((resolve) => { clip.onended = resolve; });
      await imgReady;
      still.src = nextSrc;
      await settle(still);
      clip.classList.remove('show');
      await wait(350);
      return true;
    } catch (_) {
      clip.classList.remove('show');
      return false;
    }
  }

  /* Sin video: acercamiento suave y fundido hacia la vista siguiente. */
  async function crossfade(nextSrc, forward) {
    await loadImage(nextSrc);
    stillNext.src = nextSrc;
    still.style.transformOrigin = forward ? '50% 55%' : '50% 45%';
    requestAnimationFrame(() => {
      still.classList.add('push');
      stillNext.classList.add('show');
    });
    await wait(850);
    still.style.transition = 'none';
    still.src = nextSrc;
    still.classList.remove('push');
    await settle(still);
    stillNext.style.transition = 'none';
    stillNext.classList.remove('show');
    requestAnimationFrame(() => { still.style.transition = ''; stillNext.style.transition = ''; });
  }

  function preloadNeighbours() {
    [neighbour(-1), neighbour(1)].forEach((i) => {
      const s = D.STOPS[i];
      if (!s) return;
      loadImage(imgUrl(s.img));
      const key = `${D.STOPS[cur].id}>${s.id}`;
      if (D.TRANSITIONS[key]) loadClip(D.TRANSITIONS[key]);
    });
  }

  function buildStrip() {
    const strip = $('strip');
    D.STOPS.forEach((s, i) => {
      const b = el('button', { class: 'stop', type: 'button', 'aria-label': s.name }, strip);
      el('img', { src: `assets/img/${s.img}-sm.jpg`, alt: '', loading: 'lazy' }, b);
      el('span', { text: s.short || s.name }, b);
      b.addEventListener('click', () => goTo(i));
    });
  }

  /* ---------- modo planta ----------
     Igual que en un showroom inmobiliario: la planta ocupa toda la escena, cada unidad se marca
     sobre el render con su estado, y al tocarla aparece una tarjeta abajo. */
  const FW = 2250, FH = 1196;               // marco de los renders cenitales (misma proporción que el plano)
  const fv = { s: 1, x: 0, y: 0, min: 0.2, max: 3 };
  const XICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const SHORT = { pb: 'Planta baja', pa: 'Planta alta', tc: 'Terraza' };
  let floorSel = null, floorMode = '3d', floorUnit = null, dragged = false;

  const dormTxt = (d) => `${d} ${d === 1 ? 'dormitorio' : 'dormitorios'}`;
  const areaCentroid = (pts) => {
    let a = 0, x = 0, y = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      const f = x0 * y1 - x1 * y0; a += f; x += (x0 + x1) * f; y += (y0 + y1) * f;
    }
    return a ? [x / (3 * a), y / (3 * a)] : pts[0];
  };

  function openCard(html) {
    $('cardBody').innerHTML = html;
    $('cardSheet').hidden = false;
    const x = $('cardBody').querySelector('[data-x]');
    if (x) x.addEventListener('click', closeCard);
  }
  function closeCard() {
    $('cardSheet').hidden = true;
    document.querySelectorAll('.f-unit.on, .f-label.on, .uz.on').forEach((e) => e.classList.remove('on'));
    floorUnit = null;
    syncUrl();
  }

  /* Desde la fachada: tarjeta con el resumen de la planta y "Ingresar". */
  function showEnterCard(f) {
    const units = D.UNITS.filter((u) => u.planta === f.planta);
    const free = units.filter((u) => status(u.n) === 'disponible').length;
    const dorms = [...new Set(units.map((u) => u.dorm))].sort();
    openCard(`
      <div class="card-head"><h3>${f.label}</h3><button class="x" type="button" data-x aria-label="Cerrar">${XICON}</button></div>
      <div class="card-facts"><span><b>${units.length}</b> departamentos</span><span><b>${free}</b> disponibles</span>
        <span>${dorms.length > 1 ? `${dorms[0]} a ${dormTxt(dorms[dorms.length - 1])}` : dormTxt(dorms[0])}</span></div>
      <div class="card-actions one"><button class="btn dark" type="button" data-enter>Ingresar</button></div>`);
    $('cardBody').querySelector('[data-enter]').addEventListener('click', () => { $('cardSheet').hidden = true; enterFloor(f.planta); });
  }

  function enterFloor(planta, sel = null) {
    closeSheets();
    hideTip();
    $('unit').hidden = true;
    $('cardSheet').hidden = true;
    floorSel = planta;
    if (!D.PLANTAS[planta].render) floorMode = '2d';
    sr.dataset.mode = 'floor';
    $('floor').hidden = false;
    renderFloor(sel);
  }
  function exitFloor() {
    $('cardSheet').hidden = true;
    floorUnit = null;
    $('floor').hidden = true;
    sr.dataset.mode = 'stage';
    floorSel = null;
    syncUrl();
  }
  const floorSrc = (P) => (floorMode === '3d' && P.render ? `${P.render}${small() ? '-sm' : ''}.jpg` : P.plan);

  async function renderFloor(sel = null) {
    const P = D.PLANTAS[floorSel];
    $('floorName').textContent = P.name;
    const seg = $('floorSel');
    seg.replaceChildren();
    Object.keys(D.PLANTAS).forEach((k) => {
      const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === floorSel), class: k === floorSel ? 'on' : '', text: SHORT[k] }, seg);
      b.addEventListener('click', () => {
        if (k === floorSel) return;
        floorSel = k;
        floorMode = D.PLANTAS[k].render ? '3d' : '2d';
        $('cardSheet').hidden = true;
        floorUnit = null;
        renderFloor();
      });
    });
    document.querySelectorAll('#floorMode button').forEach((b) => {
      const on = b.dataset.mode === floorMode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = b.dataset.mode === '3d' && !P.render;
    });

    const src = floorSrc(P);
    await loadImage(src);
    const img = $('floorImg');
    img.src = src;
    img.alt = `${P.name}${floorMode === '3d' ? ', vista 3D' : ', plano'}`;

    const svg = $('floorSvg'), labels = $('floorLabels');
    svg.replaceChildren();
    labels.replaceChildren();
    const polys = D.POLYS[floorSel] || {};
    Object.entries(polys).forEach(([n, list]) => {
      n = +n;
      const u = unitBy(n), st = status(n);
      const g = el('g', { class: 'f-unit', tabindex: st === 'vendido' ? '-1' : '0', role: 'button', 'aria-label': `Departamento ${n}, ${dormTxt(u.dorm)}, ${STATUS_TXT[st]}` }, svg);
      g.dataset.n = n;
      list.forEach((pts) => el('polygon', { class: `f-poly st-${st}`, points: pts.map((p) => p.join(',')).join(' ') }, g));
      const [cx, cy] = areaCentroid(list[0]);
      const lb = el('button', { class: 'f-label', type: 'button', tabindex: '-1', 'aria-hidden': 'true', html: `<i class="st-${st}"></i>Depto ${n}` }, labels);
      lb.dataset.n = n;
      lb.style.left = cx + '%';
      lb.style.top = cy + '%';
      const pick = () => { if (!dragged) selectUnit(n); };
      g.addEventListener('click', pick);
      lb.addEventListener('click', pick);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectUnit(n); } });
      lb.addEventListener('pointerenter', () => g.classList.add('hover'));
      lb.addEventListener('pointerleave', () => g.classList.remove('hover'));
    });
    fitFloor();
    if (!Object.keys(polys).length && P.interior) {
      openCard(`
        <div class="card-head"><h3>${P.name}</h3><button class="x" type="button" data-x aria-label="Cerrar">${XICON}</button></div>
        <div class="card-facts"><span>Salas lounge, comedor exterior y jardineras en la cubierta, para los diez departamentos.</span></div>
        <div class="card-actions one"><button class="btn dark" type="button" data-int>Ver la terraza</button></div>`);
      $('cardBody').querySelector('[data-int]').addEventListener('click', () => openViewer([P.interior], P.interior));
    }
    if (sel) selectUnit(sel);
    syncUrl();
  }

  function selectUnit(n) {
    const u = unitBy(n);
    if (!u) return;
    floorUnit = n;
    document.querySelectorAll('.f-unit, .f-label').forEach((e) => e.classList.toggle('on', +e.dataset.n === n));
    // llevar la unidad al centro del espacio libre sobre la tarjeta
    const list = (D.POLYS[floorSel] || {})[n];
    if (list) {
      const [cx, cy] = areaCentroid(list[0]);
      const W = innerWidth, H = innerHeight, free = H - (W <= 760 ? 230 : 200);
      fv.x = W / 2 - (cx / 100) * FW * fv.s;
      fv.y = Math.max(110, free / 2 + 40) - (cy / 100) * FH * fv.s;
      clampPan();
      canvas.classList.add('glide');
      applyFloor();
      setTimeout(() => canvas.classList.remove('glide'), 500);
    }
    const st = status(n);
    const total = u.cub + u.ext + (u.bbq || 0);
    const ints = D.INTERIORS_BY_PLANTA[u.planta] || [];
    openCard(`
      <div class="card-head"><h3>Departamento ${n}</h3><span class="pillst st-${st}">${STATUS_TXT[st]}</span><button class="x" type="button" data-x aria-label="Cerrar">${XICON}</button></div>
      <div class="card-facts"><span><b>${m2(total)}</b> totales</span><span><b>${u.dorm}</b> ${u.dorm === 1 ? 'dormitorio' : 'dormitorios'}</span>
        <span>Cubierto <b>${m2(u.cub)}</b></span><span>${u.extName} <b>${m2(u.ext)}</b></span></div>
      <div class="card-actions"><button class="btn dark" type="button" data-ficha>Ver ficha</button><button class="btn ghost" type="button" data-int>Ver interiores</button></div>`);
    $('cardBody').querySelector('[data-ficha]').addEventListener('click', () => openUnit(n));
    $('cardBody').querySelector('[data-int]').addEventListener('click', () => openViewer(ints, ints[0]));
    syncUrl();
  }

  /* Desde la vista aérea: tarjeta de la unidad con acceso directo a su planta. */
  function showStageUnit(n) {
    const u = unitBy(n);
    const st = status(n);
    const total = u.cub + u.ext + (u.bbq || 0);
    zones.querySelectorAll('.uz').forEach((g) => g.classList.toggle('on', +g.dataset.n === n));
    openCard(`
      <div class="card-head"><h3>Departamento ${n}</h3><span class="pillst st-${st}">${STATUS_TXT[st]}</span><button class="x" type="button" data-x aria-label="Cerrar">${XICON}</button></div>
      <div class="card-facts"><span>${D.PLANTAS[u.planta].name}</span><span><b>${m2(total)}</b> totales</span><span><b>${u.dorm}</b> ${u.dorm === 1 ? 'dormitorio' : 'dormitorios'}</span>
        <span>${u.extName} <b>${m2(u.ext)}</b></span></div>
      <div class="card-actions"><button class="btn dark" type="button" data-floor>Ver en planta</button><button class="btn ghost" type="button" data-ficha>Ver ficha</button></div>`);
    $('cardBody').querySelector('[data-floor]').addEventListener('click', () => enterFloor(u.planta, n));
    $('cardBody').querySelector('[data-ficha]').addEventListener('click', () => openUnit(n));
  }

  /* zoom y arrastre de la planta */
  const canvas = $('floorCanvas');
  canvas.style.width = FW + 'px';
  canvas.style.height = FH + 'px';
  function applyFloor() {
    canvas.style.transform = `translate(${fv.x}px, ${fv.y}px) scale(${fv.s})`;
    canvas.style.setProperty('--inv', (1 / fv.s).toFixed(4));
  }
  function clampPan() {
    const W = innerWidth, H = innerHeight, w = FW * fv.s, h = FH * fv.s;
    fv.x = Math.min(W * 0.6, Math.max(W * 0.4 - w, fv.x));
    fv.y = Math.min(H * 0.6, Math.max(H * 0.4 - h, fv.y));
  }
  function fitFloor() {
    const W = innerWidth, H = innerHeight;
    const top = W <= 760 ? 150 : 120, bottom = W <= 760 ? 40 : 80;
    const sw = (W - 32) / FW, sh = (H - top - bottom) / FH;
    const s = Math.min(Math.max(sw, sh), Math.min(sw, sh) * 1.35);
    fv.s = s; fv.min = s * 0.9; fv.max = s * 4;
    fv.x = (W - FW * s) / 2;
    fv.y = top + (H - top - bottom - FH * s) / 2;
    applyFloor();
  }
  function zoomAt(f, cx, cy) {
    const ns = Math.min(fv.max, Math.max(fv.min, fv.s * f));
    const k = ns / fv.s;
    fv.x = cx - (cx - fv.x) * k;
    fv.y = cy - (cy - fv.y) * k;
    fv.s = ns;
    clampPan();
    applyFloor();
  }
  function bindFloor() {
    const stage = $('floorStage');
    const pts = new Map();
    let start = null, pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged = false;
      if (pts.size === 1) start = { x: e.clientX, y: e.clientY, fx: fv.x, fy: fv.y };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: fv.s };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((pinch.s * d / pinch.d) / fv.s, (a.x + b.x) / 2, (a.y + b.y) / 2);
        dragged = true;
      } else if (start) {
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!dragged && Math.hypot(dx, dy) > 6) { dragged = true; stage.classList.add('drag'); stage.setPointerCapture(e.pointerId); }
        if (dragged) { fv.x = start.fx + dx; fv.y = start.fy + dy; clampPan(); applyFloor(); }
      }
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) { start = null; stage.classList.remove('drag'); setTimeout(() => { dragged = false; }, 0); }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    $('zoomIn').addEventListener('click', () => zoomAt(1.35, innerWidth / 2, innerHeight / 2));
    $('zoomOut').addEventListener('click', () => zoomAt(1 / 1.35, innerWidth / 2, innerHeight / 2));
    $('floorBack').addEventListener('click', exitFloor);
    $('floorMode').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || b.dataset.mode === floorMode) return;
      floorMode = b.dataset.mode;
      renderFloor(floorUnit);
    });
  }

  /* ---------- lista ---------- */
  function openList() {
    closeSheets();
    $('list').hidden = false;
    renderCards('all');
  }
  function renderCards(f) {
    document.querySelectorAll('#filters .chip').forEach((c) => c.classList.toggle('on', c.dataset.f === f));
    const cards = $('cards');
    cards.replaceChildren();
    D.UNITS.filter((u) => f === 'all' || u.dorm === +f).forEach((u) => {
      const st = status(u.n);
      const b = el('button', { class: 'card', type: 'button' }, cards);
      el('div', { class: 'thumb', html: `<img src="assets/units/u${u.n}.jpg" alt="Plano del departamento ${u.n}" loading="lazy">` }, b);
      el('div', { class: 'meta', html: `<span class="badge st-${st}">${STATUS_TXT[st]}</span><h3>Departamento ${u.n}</h3><p>${D.PLANTAS[u.planta].name} · ${u.dorm} dorm. · ${m2(u.cub + u.ext + (u.bbq || 0))} totales</p>` }, b);
      b.addEventListener('click', () => openUnit(u.n));
    });
  }

  /* ---------- ficha ---------- */
  function openUnit(n) {
    const u = unitBy(n);
    if (!u) return;
    unitSel = n;
    const st = status(n);
    const total = u.cub + u.ext + (u.bbq || 0);
    const ints = D.INTERIORS_BY_PLANTA[u.planta] || [];
    $('unitBody').innerHTML = `
      <span class="badge st-${st}">${STATUS_TXT[st]}</span>
      <h2>Departamento ${n}</h2>
      <p class="sub">${D.PLANTAS[u.planta].name} · ${u.dorm} ${u.dorm === 1 ? 'dormitorio' : 'dormitorios'}</p>
      <img class="uplan" src="assets/units/u${n}.jpg" alt="Plano del departamento ${n}">
      <dl class="kv">
        <dt>Área cubierta</dt><dd>${m2(u.cub)}</dd>
        <dt>${u.extName}</dt><dd>${m2(u.ext)}</dd>
        ${u.bbq ? `<dt>BBQ</dt><dd>${m2(u.bbq)}</dd>` : ''}
        <dt class="tot">Total</dt><dd class="tot">${m2(total)}</dd>
      </dl>
      <ul class="rooms">${u.rooms.map((r) => `<li>${r}</li>`).join('')}</ul>
      <div class="u-int">${ints.map((k) => `<button type="button" data-int="${k}"><img src="assets/img/${D.INTERIORS[k].img}-sm.jpg" alt="" loading="lazy"><span>${D.INTERIORS[k].name}</span></button>`).join('')}</div>
      <p class="ref">Interiores referenciales de ${D.PLANTAS[u.planta].name.toLowerCase()}.</p>
      <div class="u-actions">
        <button class="btn" type="button" data-plan-unit>Ver en planta</button>
        <button class="btn ghost" type="button" data-int-all>Ver interiores</button>
      </div>`;
    $('unit').hidden = false;
    $('unitBody').querySelectorAll('[data-int]').forEach((b) => b.addEventListener('click', () => openViewer(ints, b.dataset.int)));
    $('unitBody').querySelector('[data-int-all]').addEventListener('click', () => openViewer(ints, ints[0]));
    $('unitBody').querySelector('[data-plan-unit]').addEventListener('click', () => { $('unit').hidden = true; $('viewer').hidden = true; enterFloor(u.planta, n); });
    syncUrl();
  }

  /* ---------- interiores ---------- */
  function openViewer(keys, active) {
    const v = $('viewer');
    v.hidden = false;
    const thumbs = $('viewerThumbs');
    thumbs.replaceChildren();
    const show = (k) => {
      const it = D.INTERIORS[k];
      const img = $('viewerImg');
      img.style.animation = 'none';
      img.src = imgUrl(it.img);
      img.alt = it.name;
      void img.offsetWidth;
      img.style.animation = '';
      $('viewerName').textContent = it.name;
      thumbs.querySelectorAll('.stop').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    };
    if (keys.length > 1) keys.forEach((k) => {
      const b = el('button', { class: 'stop', type: 'button', 'aria-label': D.INTERIORS[k].name }, thumbs);
      b.dataset.k = k;
      el('img', { src: `assets/img/${D.INTERIORS[k].img}-sm.jpg`, alt: '' }, b);
      el('span', { text: D.INTERIORS[k].name }, b);
      b.addEventListener('click', () => show(k));
    });
    show(active);
  }

  /* ---------- general ---------- */
  function closeSheets() {
    $('list').hidden = true;
  }
  function closeTop() {
    if (!$('viewer').hidden) { $('viewer').hidden = true; return; }
    if (!$('unit').hidden) { $('unit').hidden = true; unitSel = null; syncUrl(); return; }
    if (!$('list').hidden) { closeSheets(); return; }
    if (!$('cardSheet').hidden) { closeCard(); return; }
    if (!$('floor').hidden) exitFloor();
  }
  function syncUrl() {
    try {
      const q = new URLSearchParams(location.search);
      q.set('vista', D.STOPS[cur].id);
      if (floorSel) q.set('planta', floorSel); else q.delete('planta');
      const dep = unitSel || floorUnit;
      if (dep) q.set('depto', dep); else q.delete('depto');
      history.replaceState(null, '', '?' + q.toString());
    } catch (_) { /* iframe sandbox */ }
  }

  function bind() {
    $('prevBtn').addEventListener('click', () => step(-1));
    $('nextBtn').addEventListener('click', () => step(1));
    $('openPlans').addEventListener('click', () => enterFloor(floorSel || 'pb'));
    $('openList').addEventListener('click', openList);
    $('fullBtn').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement);
    });
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
    document.querySelector('[data-close-unit]').addEventListener('click', () => { $('unit').hidden = true; unitSel = null; syncUrl(); });
    document.querySelector('[data-close-viewer]').addEventListener('click', () => { $('viewer').hidden = true; });
    $('filters').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) renderCards(c.dataset.f); });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeTop();
      const free = $('floor').hidden && $('list').hidden && $('viewer').hidden && $('unit').hidden;
      if (!free) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    });
    // deslizar en táctil
    let x0 = null;
    $('scene').addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    $('scene').addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
      x0 = null;
    });
    let rz;
    addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { placePins(); if (floorSel) fitFloor(); }); });
    bindFloor();
    still.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  async function init() {
    // Dentro de la web la marca ya está en la cabecera: se oculta la del showroom.
    if (window.top !== window) sr.classList.add('embedded');
    const q = new URLSearchParams(location.search);
    const i = D.STOPS.findIndex((s) => s.id === q.get('vista'));
    cur = i >= 0 ? i : 0;
    buildStrip();
    bind();
    const first = imgUrl(D.STOPS[cur].img);
    await loadImage(first);
    still.src = first;
    renderStop();
    $('loading').classList.add('done');
    preloadNeighbours();
    const dep = +q.get('depto');
    const planta = q.get('planta');
    if (D.PLANTAS[planta]) enterFloor(planta, unitBy(dep) ? dep : null);
    else if (unitBy(dep)) enterFloor(unitBy(dep).planta, dep);
  }
  init();
})();
