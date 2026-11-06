(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Duraciones de los fundidos en milisegundos.
  const FADE = {
    enter: 700,     // portada a video de ida
    still: 800,     // video de ida a imagen final
    toReverse: 550, // imagen final a video invertido
    match: 120,     // video de ida pausado a video invertido (mismo cuadro)
    exit: 700,      // video invertido a portada
    fallback: 600   // regreso directo cuando no hay video invertido
  };
  const ms = (value) => (reducedMotion ? 0 : value);

  const cover = $('cover');
  const experience = $('experience');
  const media = $('media');
  const reverse = $('reverse-video');
  const finalImage = $('final-image');
  const tooltip = $('tooltip');
  const loading = $('loading');
  const soundButton = $('sound-button');

  const forwardVideos = new Map();
  const preloadedImages = new Map();

  // idle: portada | opening: video de ida | interior: imagen final
  // reversing: video invertido | closing: fundido hacia la portada
  let state = 'idle';
  let run = 0;
  let selected = null;
  let forward = null;
  let soundOn = false;
  let lastInputKeyboard = false;
  let loadingTimer = null;
  let slowTimer = null;
  let toastTimer = null;

  const wait = (time) => new Promise((resolve) => setTimeout(resolve, time));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function notify(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200);
  }

  function clearTimers() {
    clearTimeout(loadingTimer);
    clearTimeout(slowTimer);
  }

  function setPhase(phase) {
    experience.dataset.phase = phase;
  }

  function fade(element, visible, duration) {
    element.style.transitionDuration = `${ms(duration)}ms`;
    element.classList.toggle('visible', visible);
  }

  function hideLoading() {
    clearTimeout(loadingTimer);
    loading.classList.remove('show');
  }

  // Espera un evento del elemento multimedia; falla con 'error' o al agotar el tiempo.
  function waitForMedia(element, events, timeout) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const finish = (callback) => {
        clearTimeout(timer);
        events.forEach((name) => element.removeEventListener(name, onOk));
        element.removeEventListener('error', onFail);
        callback();
      };
      const onOk = () => finish(resolve);
      const onFail = () => finish(() => reject(new Error('media')));
      events.forEach((name) => element.addEventListener(name, onOk));
      element.addEventListener('error', onFail);
      if (timeout) timer = setTimeout(onFail, timeout);
    });
  }

  // Resuelve cuando el navegador ya pintó un cuadro del video.
  function firstFrame(element) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 400);
      const done = () => { clearTimeout(timer); resolve(); };
      if (typeof element.requestVideoFrameCallback === 'function') {
        element.requestVideoFrameCallback(done);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(done));
      }
    });
  }

  function playVideo(element) {
    let attempt;
    try {
      attempt = element.play();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!attempt || typeof attempt.then !== 'function') return waitForMedia(element, ['playing'], 6000);
    return attempt.catch((error) => {
      // Si el navegador no permite audio, se reproduce en silencio.
      if (error && error.name === 'NotAllowedError' && !element.muted) {
        element.muted = true;
        setSound(false);
        return element.play();
      }
      throw error;
    });
  }

  // Solo cuenta como falla un error real: networkState pasa por 'sin fuente' al asignar src.
  function mediaFailed(element) {
    return !!element.error;
  }

  function imageReady(image, timeout) {
    if (!image.getAttribute('src')) return Promise.resolve(false);
    const loaded = () => image.complete && image.naturalWidth > 0;
    const decoded = typeof image.decode === 'function'
      ? image.decode().then(() => true, loaded)
      : new Promise((resolve) => {
        if (image.complete) return resolve(loaded());
        image.addEventListener('load', () => resolve(true), { once: true });
        image.addEventListener('error', () => resolve(false), { once: true });
      });
    return Promise.race([decoded, wait(timeout).then(loaded)]);
  }

  /* ---------- Precarga ---------- */

  function getForwardVideo(item) {
    if (!item.video) return null;
    let element = forwardVideos.get(item.id);
    if (element) return element;
    element = document.createElement('video');
    element.className = 'layer tour-video';
    element.muted = true;
    element.defaultMuted = true;
    element.setAttribute('muted', '');
    element.playsInline = true;
    element.setAttribute('playsinline', '');
    element.setAttribute('webkit-playsinline', '');
    element.setAttribute('aria-hidden', 'true');
    element.disablePictureInPicture = true;
    element.preload = 'auto';
    element.src = item.video;
    element.addEventListener('ended', () => {
      if (element === forward && state === 'opening') showInterior();
    });
    element.addEventListener('error', () => {
      if (element === forward && state === 'opening') {
        console.info(`Video no disponible para ${item.name}. Se mostrará la imagen final.`);
        showInterior();
      }
    });
    media.insertBefore(element, finalImage);
    forwardVideos.set(item.id, element);
    return element;
  }

  function preload(item) {
    if (!item || item.status !== 'available') return;
    getForwardVideo(item);
    if (item.image && !preloadedImages.has(item.image)) {
      const image = new Image();
      image.decoding = 'async';
      image.src = item.image;
      preloadedImages.set(item.image, image);
    }
  }

  function prepareReverse(item) {
    reverse.pause();
    fade(reverse, false, 0);
    if (item.videoReverse) {
      if (reverse.getAttribute('src') !== item.videoReverse) reverse.src = item.videoReverse;
    } else if (reverse.getAttribute('src')) {
      reverse.removeAttribute('src');
      reverse.load();
    }
  }

  /* ---------- Sonido ---------- */

  function setSound(on) {
    soundOn = on;
    const label = on ? 'Silenciar sonido' : 'Activar sonido';
    soundButton.classList.toggle('is-on', on);
    soundButton.setAttribute('aria-pressed', String(on));
    soundButton.setAttribute('aria-label', label);
    soundButton.title = label;
    if (forward) forward.muted = !on;
  }

  /* ---------- Portada ---------- */

  function setActive(id, event) {
    document.querySelectorAll('[data-apartment]').forEach((element) => {
      element.classList.toggle('active', element.dataset.apartment === id);
    });
    const item = window.FLOORS.find((floor) => floor.id === id);
    preload(item);
    if (!item || !event || event.pointerType === 'touch') return;
    tooltip.innerHTML = `<strong>${item.name}</strong><small>${item.status === 'soon' ? 'Próximamente' : item.nivel + ' · Ver recorrido'}</small>`;
    tooltip.style.left = `${event.clientX}px`;
    tooltip.style.top = `${Math.max(90, event.clientY - 60)}px`;
    tooltip.classList.add('visible');
    tooltip.setAttribute('aria-hidden', 'false');
  }

  function clearActive() {
    document.querySelectorAll('[data-apartment]').forEach((element) => element.classList.remove('active'));
    tooltip.classList.remove('visible');
    tooltip.setAttribute('aria-hidden', 'true');
  }

  /* ---------- Ida: portada, video e imagen final ---------- */

  async function openApartment(item) {
    if (state !== 'idle') return;
    if (item.status !== 'available') {
      notify(`${item.name}: este recorrido estará disponible próximamente.`);
      return;
    }
    clearActive();
    const id = ++run;
    state = 'opening';
    selected = item;
    preload(item);
    forward = getForwardVideo(item);

    $('tour-label').textContent = `${item.nivel} · ${item.name}`;
    $('interior-level').textContent = item.nivel;
    $('interior-name').textContent = item.name;
    $('interior-description').textContent = item.description;
    if (item.image) {
      finalImage.src = item.image;
      finalImage.alt = `${item.name}, vista del interior`;
    } else {
      finalImage.removeAttribute('src');
      finalImage.alt = '';
    }
    prepareReverse(item);

    experience.classList.add('is-open');
    experience.removeAttribute('inert');
    experience.setAttribute('aria-hidden', 'false');
    cover.setAttribute('inert', '');
    setPhase('video');

    if (!forward || mediaFailed(forward)) {
      showInterior();
      return;
    }

    loadingTimer = setTimeout(() => {
      if (run === id && state === 'opening' && !forward.classList.contains('visible')) loading.classList.add('show');
    }, 250);
    slowTimer = setTimeout(() => {
      if (run === id && state === 'opening' && forward.readyState < 3) notify('El video tarda en cargar. Puedes ver el interior con el botón inferior.');
    }, 4500);

    try {
      forward.muted = !soundOn;
      if (forward.currentTime > 0) forward.currentTime = 0;
      await playVideo(forward);
      await firstFrame(forward);
      if (run !== id || state !== 'opening') return;
      hideLoading();
      fade(forward, true, FADE.enter);
    } catch (error) {
      if (run !== id || state !== 'opening') return;
      console.info(`No se pudo reproducir el video de ${item.name}. Se mostrará la imagen final.`);
      showInterior();
    }
  }

  async function showInterior() {
    if (!selected || state !== 'opening') return;
    const id = run;
    state = 'interior';
    clearTimers();
    hideLoading();
    if (forward) forward.pause();
    setPhase('interior');
    await imageReady(finalImage, 2500);
    if (run !== id || state !== 'interior') return;
    finalImage.classList.remove('zoom');
    void finalImage.offsetWidth; // reinicia la animación de acercamiento
    finalImage.classList.add('zoom');
    fade(finalImage, true, FADE.still);
    $('back-button').focus({ preventScroll: true });
  }

  /* ---------- Regreso: video invertido y fundido a la portada ---------- */

  async function goBack() {
    if (state !== 'opening' && state !== 'interior') return;
    const id = ++run;
    const fromInterior = state === 'interior';
    const forwardShown = !!forward && forward.classList.contains('visible');
    const time = forwardShown ? forward.currentTime : 0;
    clearTimers();
    hideLoading();
    if (forward) forward.pause();
    state = 'reversing';
    experience.classList.add('is-busy');

    const canReverse = !!selected.videoReverse && !mediaFailed(reverse) && (fromInterior || time > 0.05);
    if (!canReverse) {
      closeTo(id, FADE.fallback);
      return;
    }

    $('tour-label').textContent = 'Regresando a la vista exterior';
    setPhase('reverse');

    try {
      if (reverse.readyState < 1) await waitForMedia(reverse, ['loadedmetadata'], 3000);
      if (run !== id) return;
      const duration = reverse.duration;
      if (!isFinite(duration) || duration <= 0) throw new Error('duracion');
      const target = fromInterior ? 0 : clamp(duration - time, 0, Math.max(0, duration - 0.1));
      const fadeIn = fromInterior ? FADE.toReverse : FADE.match;
      reverse.muted = true;

      if (reverse.readyState >= 2) {
        // Datos listos: se posiciona en pausa, se funde y luego arranca.
        if (Math.abs(reverse.currentTime - target) > 0.02) {
          const seeked = waitForMedia(reverse, ['seeked'], 3000);
          reverse.currentTime = target;
          await seeked;
        }
        if (run !== id) return;
        fade(reverse, true, fadeIn);
        await wait(ms(fadeIn));
        if (run !== id) return;
        await playVideo(reverse);
      } else {
        // Algunos navegadores móviles solo cargan datos al reproducir.
        reverse.currentTime = target;
        await playVideo(reverse);
        await firstFrame(reverse);
        if (run !== id) return;
        fade(reverse, true, fadeIn);
        await wait(ms(fadeIn));
      }
      if (run !== id) return;

      // Las capas de abajo ya están cubiertas; se ocultan sin que se note.
      if (forward) fade(forward, false, 0);
      fade(finalImage, false, 0);

      const remaining = Math.max(0, reverse.duration - reverse.currentTime) * 1000;
      if (!reverse.ended) await waitForMedia(reverse, ['ended'], remaining + 2500);
      if (run !== id) return;
      closeTo(id, FADE.exit);
    } catch (error) {
      if (run !== id) return;
      console.info('Video de regreso no disponible. Se usará un fundido a la portada.');
      closeTo(id, FADE.fallback);
    }
  }

  async function closeTo(id, duration) {
    state = 'closing';
    experience.classList.add('is-busy');
    hideLoading();
    setPhase('none');
    fade(reverse, false, duration);
    fade(finalImage, false, duration);
    forwardVideos.forEach((element) => fade(element, false, duration));
    await wait(ms(duration) + 40);
    if (run !== id) return;
    finishClose();
  }

  function finishClose() {
    reverse.pause();
    forwardVideos.forEach((element) => {
      element.pause();
      try { if (element.currentTime > 0) element.currentTime = 0; } catch (error) { /* sin datos aún */ }
    });
    finalImage.classList.remove('zoom');
    experience.classList.remove('is-open', 'is-busy');
    experience.setAttribute('inert', '');
    experience.setAttribute('aria-hidden', 'true');
    cover.removeAttribute('inert');
    const opener = selected;
    selected = null;
    forward = null;
    state = 'idle';
    if (lastInputKeyboard && opener) {
      const hotspot = document.querySelector(`.hotspot[data-apartment="${opener.id}"]`);
      if (hotspot) hotspot.focus({ preventScroll: true });
    }
  }

  /* ---------- Construcción de la portada ---------- */

  function build() {
    if (!Array.isArray(window.FLOORS)) {
      notify('No se pudo cargar la configuración de departamentos.');
      return;
    }
    const available = window.FLOORS.filter((item) => item.status === 'available').length;
    $('available-count').textContent = `${available} recorridos`;
    window.FLOORS.forEach((item) => {
      const group = document.createElementNS(svgNS, 'g');
      group.setAttribute('class', `hotspot ${item.status === 'soon' ? 'soon' : ''}`);
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', `${item.name}, ${item.nivel}${item.status === 'soon' ? ', próximamente' : ''}`);
      group.dataset.apartment = item.id;
      const polygon = document.createElementNS(svgNS, 'polygon');
      polygon.setAttribute('class', 'zone');
      polygon.setAttribute('points', item.points.map((point) => point.join(',')).join(' '));
      group.appendChild(polygon);
      group.addEventListener('pointerenter', (event) => setActive(item.id, event));
      group.addEventListener('pointermove', (event) => setActive(item.id, event));
      group.addEventListener('pointerleave', clearActive);
      group.addEventListener('focus', () => setActive(item.id));
      group.addEventListener('blur', clearActive);
      group.addEventListener('click', () => openApartment(item));
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openApartment(item);
        }
      });
      $('hotspots').appendChild(group);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'apartment-item';
      button.dataset.apartment = item.id;
      const number = item.number || item.id.replace(/\D/g, '').padStart(2, '0');
      button.innerHTML = `<span class="apartment-number">${number}</span><span class="apartment-copy"><span class="apartment-name">${item.name}</span><span class="apartment-level">${item.nivel}</span></span>${item.status === 'soon' ? '<span class="soon-badge">Pronto</span>' : '<span class="apartment-arrow" aria-hidden="true">↗</span>'}`;
      button.addEventListener('pointerenter', (event) => setActive(item.id, event));
      button.addEventListener('pointerleave', clearActive);
      button.addEventListener('focus', () => setActive(item.id));
      button.addEventListener('blur', clearActive);
      button.addEventListener('click', () => openApartment(item));
      $('apartment-list').appendChild(button);
    });
  }

  // Durante la reversa y el fundido final se ignoran clics y toques.
  experience.addEventListener('click', (event) => {
    if (state === 'reversing' || state === 'closing') {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener('keydown', () => { lastInputKeyboard = true; }, true);
  document.addEventListener('pointerdown', () => { lastInputKeyboard = false; }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state === 'reversing' || state === 'closing') {
      event.preventDefault();
      return;
    }
    goBack();
  });

  // Si la página que contiene este selector cambia de sección, se vuelve a la portada sin animación.
  function resetNow() {
    if (state === 'idle') return;
    run++;
    clearTimers();
    hideLoading();
    setPhase('none');
    fade(reverse, false, 0);
    fade(finalImage, false, 0);
    forwardVideos.forEach((element) => fade(element, false, 0));
    lastInputKeyboard = false;
    finishClose();
  }
  window.addEventListener('message', (event) => {
    if (event.source === window.parent && event.data && event.data.type === 'alheli:reset') resetNow();
  });

  $('skip-button').addEventListener('click', showInterior);
  $('back-button').addEventListener('click', goBack);
  soundButton.addEventListener('click', () => setSound(!soundOn));

  setSound(false);
  setPhase('none');
  build();
})();
