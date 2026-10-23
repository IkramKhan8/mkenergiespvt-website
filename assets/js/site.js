/* MK Energies — shared site behaviour (no dependencies) */
(() => {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  // Safety net: if entrance animations stall (a page first painted late or in the background),
  // drop them so headlines and hero content are never left invisible.
  if (root.classList.contains('intro')) setTimeout(() => root.classList.remove('intro'), 2200);
  const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* storage blocked */ } }
  };

  /* ---------- Toast ---------- */
  let toastEl;
  let toastTimer;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    requestAnimationFrame(() => toastEl.classList.add('is-on'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
  }

  /* ---------- Theme: site toggle (data-mode) > viewer theme (data-theme) > OS setting ---------- */
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const currentTheme = () => root.dataset.mode || root.dataset.theme || (systemDark.matches ? 'dark' : 'light');

  function syncThemeControls() {
    const theme = currentTheme();
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      const label = btn.querySelector('[data-theme-label]');
      if (label) label.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#030A12' : '#F3F6F9');
  }

  function setTheme(next, x, y) {
    const apply = () => {
      root.dataset.mode = next;
      store.set('mk-theme', next);
      syncThemeControls();
    };
    if (reduceMotion || typeof document.startViewTransition !== 'function') { apply(); return; }
    root.classList.add('theme-vt');
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(apply);
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(.7, 0, .3, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
    transition.finished.finally(() => root.classList.remove('theme-vt'));
  }

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-theme-toggle]');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark', rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  if (systemDark.addEventListener) systemDark.addEventListener('change', syncThemeControls);
  new MutationObserver(syncThemeControls).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('storage', (event) => {
    if (event.key === 'mk-theme' && (event.newValue === 'dark' || event.newValue === 'light')) {
      root.dataset.mode = event.newValue;
      syncThemeControls();
    }
  });
  syncThemeControls();

  /* ---------- Header state ---------- */
  const header = document.querySelector('.site-header');
  const onScroll = () => { if (header) header.classList.toggle('is-scrolled', window.scrollY > 8); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  const menu = document.getElementById('mobile-menu');
  const menuOpenBtn = document.querySelector('[data-menu-open]');
  function focusables() {
    return [...menu.querySelectorAll('a[href], button:not([disabled])')].filter((el) => el.offsetParent !== null);
  }
  function openMenu() {
    menu.hidden = false;
    root.classList.add('menu-open');
    menuOpenBtn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')));
    const first = menu.querySelector('[data-menu-close]');
    if (first) first.focus();
  }
  function closeMenu(returnFocus = true) {
    menu.classList.remove('is-open');
    root.classList.remove('menu-open');
    menuOpenBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!menu.classList.contains('is-open')) menu.hidden = true; }, 380);
    if (returnFocus) menuOpenBtn.focus();
  }
  if (menu && menuOpenBtn) {
    menuOpenBtn.addEventListener('click', openMenu);
    menu.querySelectorAll('[data-menu-close]').forEach((btn) => btn.addEventListener('click', () => closeMenu()));
    menu.querySelectorAll('a[href]').forEach((link) => link.addEventListener('click', () => closeMenu(false)));
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeMenu(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    window.matchMedia('(min-width: 1025px)').addEventListener('change', (mq) => {
      if (mq.matches && !menu.hidden) closeMenu(false);
    });
  }

  /* ---------- Contour maps ----------
     Each <canvas class="topo"> draws topographic contour lines: Perlin noise sampled on a grid,
     traced with marching squares. data-topo="live" drifts slowly (and swells under the pointer);
     "static" draws one frame. Live maps only animate while on screen. */
  const PERM = (() => {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) p[i] = i;
    let seed = 2026;
    for (let i = 255; i > 0; i -= 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const j = seed % (i + 1);
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];
    return perm;
  })();
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  function noise(x, y, z) {
    const fx = Math.floor(x); const fy = Math.floor(y); const fz = Math.floor(z);
    const X = fx & 255; const Y = fy & 255; const Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = fade(x); const v = fade(y); const w = fade(z);
    const A = PERM[X] + Y; const AA = PERM[A] + Z; const AB = PERM[A + 1] + Z;
    const B = PERM[X + 1] + Y; const BA = PERM[B] + Z; const BB = PERM[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
        lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  }
  const TONES = {
    blue: [[0, '56,182,240'], [0.55, '36,165,98'], [1, '199,232,43']],
    green: [[0, '36,165,98'], [0.6, '116,207,70'], [1, '199,232,43']]
  };
  const CELL = 14;
  const LEVELS = 14;
  const FREQ = 0.0024;

  function contourMap(canvas, index) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const live = canvas.dataset.topo === 'live' && !reduceMotion;
    const stops = TONES[canvas.dataset.tone] || TONES.blue;
    const zone = canvas.parentElement;
    const offX = index * 31.7;
    const offY = index * 17.3;
    const pointer = { x: 0, y: 0, amp: 0, target: 0 };
    let w = 0; let h = 0; let cols = 0; let rows = 0; let dpr = 1;
    let field = null; let minor; let major; let mask;
    let t = index * 2.7;
    let last = 0; let frame = 0; let running = false; let visible = false;

    function compute() {
      const swell = pointer.amp > 0.002;
      const spread = 2 * 130 * 130;
      let k = 0;
      for (let j = 0; j <= rows; j += 1) {
        const y = j * CELL;
        for (let i = 0; i <= cols; i += 1) {
          const x = i * CELL;
          let v = noise(x * FREQ + offX, y * FREQ + offY, t) * 0.78
            + noise(x * FREQ * 2.3 + 40, y * FREQ * 2.3 + 12, t * 1.4) * 0.22;
          v = 0.5 + v * 0.95;
          if (swell) {
            const dx = x - pointer.x; const dy = y - pointer.y;
            v += pointer.amp * Math.exp(-(dx * dx + dy * dy) / spread);
          }
          field[k] = v;
          k += 1;
        }
      }
    }
    function seg(x1, y1, x2, y2) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    function trace(level) {
      const stride = cols + 1;
      for (let j = 0; j < rows; j += 1) {
        const y = j * CELL;
        for (let i = 0; i < cols; i += 1) {
          const k = j * stride + i;
          const a = field[k]; const b = field[k + 1]; const c = field[k + stride + 1]; const d = field[k + stride];
          const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
          if (code === 0 || code === 15) continue;
          const x = i * CELL;
          // where the level crosses each edge of the cell (corners: a top-left, b top-right, c bottom-right, d bottom-left)
          const tx = x + CELL * (level - a) / (b - a);
          const ry = y + CELL * (level - b) / (c - b);
          const bx = x + CELL * (level - d) / (c - d);
          const ly = y + CELL * (level - a) / (d - a);
          switch (code) {
            case 1: case 14: seg(x, ly, bx, y + CELL); break;
            case 2: case 13: seg(bx, y + CELL, x + CELL, ry); break;
            case 3: case 12: seg(x, ly, x + CELL, ry); break;
            case 4: case 11: seg(tx, y, x + CELL, ry); break;
            case 5: seg(tx, y, x + CELL, ry); seg(x, ly, bx, y + CELL); break;
            case 6: case 9: seg(tx, y, bx, y + CELL); break;
            case 7: case 8: seg(x, ly, tx, y); break;
            default: seg(x, ly, tx, y); seg(bx, y + CELL, x + CELL, ry); break; // 10
          }
        }
      }
    }
    function draw() {
      if (!field) return;
      compute();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, w, h);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 2; pass += 1) {
        ctx.beginPath();
        for (let k = 0; k < LEVELS; k += 1) {
          if ((k % 4 === 2) === (pass === 1)) trace(0.08 + k * (0.84 / (LEVELS - 1)));
        }
        ctx.strokeStyle = pass ? major : minor;
        ctx.lineWidth = pass ? 1.3 : 0.85;
        ctx.stroke();
      }
      // strongest top right, fading toward the text
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.round(rect.width));
      const nh = Math.max(1, Math.round(rect.height));
      if (nw === w && nh === h && field) return;
      w = nw; h = nh;
      // sharp on high-density screens, but capped at about 3 million pixels so big panels stay cheap to redraw
      dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3.2e6 / (w * h))));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / CELL);
      rows = Math.ceil(h / CELL);
      field = new Float32Array((cols + 1) * (rows + 1));
      const tone = (alpha) => {
        const g = ctx.createLinearGradient(0, h, w, 0);
        stops.forEach(([at, rgb]) => g.addColorStop(at, `rgba(${rgb},${alpha})`));
        return g;
      };
      minor = tone(0.26);
      major = tone(0.6);
      mask = ctx.createRadialGradient(w * 0.82, h * 0.1, 0, w * 0.82, h * 0.1, Math.hypot(w, h) * 0.95);
      mask.addColorStop(0, 'rgba(0,0,0,1)');
      mask.addColorStop(0.5, 'rgba(0,0,0,.72)');
      mask.addColorStop(1, 'rgba(0,0,0,.16)');
      draw();
    }
    function loop(now) {
      frame = 0;
      if (!running) return;
      frame = requestAnimationFrame(loop);
      if (now - last < 45) return; // about 22 frames a second is plenty for slow drift
      t += Math.min(now - last, 100) * 0.00006;
      last = now;
      pointer.amp += (pointer.target - pointer.amp) * 0.14;
      draw();
    }
    function start() {
      if (!live || !visible || running || document.hidden) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    resize();
    if ('ResizeObserver' in window) {
      let pending = 0;
      new ResizeObserver(() => {
        if (pending) return;
        pending = requestAnimationFrame(() => { pending = 0; resize(); });
      }).observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
    if (!live) return;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) start(); else stop();
      }).observe(canvas);
    } else {
      visible = true;
      start();
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    if (finePointer && zone) {
      zone.addEventListener('pointermove', (event) => {
        const rect = canvas.getBoundingClientRect();
        pointer.x = event.clientX - rect.left;
        pointer.y = event.clientY - rect.top;
        pointer.target = 0.16;
      });
      zone.addEventListener('pointerleave', () => { pointer.target = 0; });
    }
  }
  document.querySelectorAll('canvas.topo').forEach((canvas, index) => contourMap(canvas, index));

  /* ---------- Stage glow follows the pointer ---------- */
  if (finePointer && !reduceMotion) {
    document.querySelectorAll('.stage').forEach((stage) => {
      stage.addEventListener('pointermove', (event) => {
        const rect = stage.getBoundingClientRect();
        stage.style.setProperty('--gx', `${event.clientX - rect.left}px`);
        stage.style.setProperty('--gy', `${event.clientY - rect.top}px`);
        stage.style.setProperty('--glow', '1');
      });
      stage.addEventListener('pointerleave', () => stage.style.setProperty('--glow', '0'));
    });
  }

  /* ---------- Scroll reveal ----------
     Content is visible at rest. Only after the visitor starts scrolling are the
     blocks still below the fold hidden, so they can animate in as they arrive. */
  const revealEls = [...document.querySelectorAll('[data-reveal]')];
  if (revealEls.length && 'IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        io.unobserve(el);
        el.classList.add('is-in');
        // once revealed, drop the reveal transition so hover effects respond instantly
        const delay = parseFloat(getComputedStyle(el).getPropertyValue('--rd')) || 0;
        setTimeout(() => el.classList.remove('is-armed', 'is-in'), delay + 1100);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
    const arm = () => {
      const limit = window.innerHeight * 1.04;
      revealEls.forEach((el) => {
        if (el.getBoundingClientRect().top > limit) {
          el.classList.add('is-armed');
          io.observe(el);
        }
      });
    };
    window.addEventListener('scroll', arm, { once: true, passive: true });
  }

  /* ---------- Survey-to-supply line fills as it comes into view ---------- */
  document.querySelectorAll('[data-flow]').forEach((flowEl) => {
    if (reduceMotion || !('IntersectionObserver' in window)) { flowEl.classList.add('is-in'); return; }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      flowEl.classList.add('is-in');
      io.disconnect();
    }, { threshold: 0.35 });
    io.observe(flowEl);
  });

  /* ---------- Card spotlight ---------- */
  document.querySelectorAll('[data-spot]').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  });

  /* ---------- FAQ accordion ---------- */
  function setOpen(item, open) {
    item.classList.toggle('is-open', open);
    const q = item.querySelector('.faq-q');
    if (q) q.setAttribute('aria-expanded', String(open));
  }
  document.querySelectorAll('.faq-item').forEach((item) => {
    const q = item.querySelector('.faq-q');
    if (q) q.addEventListener('click', () => setOpen(item, !item.classList.contains('is-open')));
  });

  /* ---------- FAQ search + topic filter ---------- */
  const faqSearch = document.getElementById('faq-search');
  const faqGroups = [...document.querySelectorAll('[data-faq-group]')];
  if (faqSearch && faqGroups.length) {
    const cats = [...document.querySelectorAll('[data-faq-filter]')];
    const empty = document.querySelector('[data-faq-empty]');
    const termEl = document.querySelector('[data-faq-term]');
    let topic = 'all';
    const apply = () => {
      const term = faqSearch.value.trim().toLowerCase();
      let shown = 0;
      faqGroups.forEach((group) => {
        let inGroup = 0;
        const topicMatch = topic === 'all' || group.dataset.faqGroup === topic;
        group.querySelectorAll('.faq-item').forEach((item) => {
          const hit = topicMatch && (!term || item.textContent.toLowerCase().includes(term));
          item.hidden = !hit;
          if (hit) {
            inGroup += 1;
            if (term.length > 2) setOpen(item, true);
          }
        });
        group.hidden = inGroup === 0;
        shown += inGroup;
      });
      if (empty) empty.hidden = shown > 0;
      if (termEl) termEl.textContent = faqSearch.value.trim() || topic;
    };
    faqSearch.addEventListener('input', apply);
    cats.forEach((btn) => btn.addEventListener('click', () => {
      topic = btn.dataset.faqFilter;
      cats.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      apply();
    }));
    document.querySelectorAll('[data-faq-reset]').forEach((btn) => btn.addEventListener('click', () => {
      faqSearch.value = '';
      topic = 'all';
      cats.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.faqFilter === 'all')));
      apply();
      faqSearch.focus();
    }));
  }

  /* ---------- Copy buttons ---------- */
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.getAttribute('data-copy');
    const label = btn.getAttribute('data-copy-label') || `Copied ${text}`;
    const fallback = () => {
      const scope = btn.closest('[data-copy-scope]');
      const target = scope && scope.querySelector('[data-copy-text]');
      if (target) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      toast('Selected. Press Ctrl+C (or ⌘C) to copy.');
    };
    try {
      navigator.clipboard.writeText(text).then(() => toast(label), fallback);
    } catch (e) {
      fallback();
    }
  });

  /* ---------- Forms (enquiry, careers): send to Formspree on the live site; the Artifact copy only previews ---------- */
  const TOPIC_PRESETS = {
    exploration: 'Oil and gas exploration',
    drilling: 'Drilling services',
    mining: 'Mining and minerals',
    lpg: 'LPG and gas supply',
    bulk: 'LPG and gas supply',
    cylinders: 'LPG and gas supply',
    petroleum: 'Petroleum and energy services',
    oil: 'Petroleum and energy services',
    energy: 'Petroleum and energy services',
    dealer: 'Becoming a distributor or dealer',
    partner: 'Partnership or investment'
  };

  document.querySelectorAll('form[data-form]').forEach((form) => {
    const kind = form.dataset.form;
    const done = document.getElementById(`${kind}-done`);
    const alertBox = document.getElementById(`${kind}-error`);
    const submitBtn = form.querySelector('[type="submit"]');
    const submitLabel = submitBtn.querySelector('[data-submit-label]');
    const idleLabel = submitLabel ? submitLabel.textContent : '';
    const isPreview = form.hasAttribute('data-preview');
    const checked = [...form.querySelectorAll('[required], [data-check]')];

    // contact.html#dealer (and the other presets) opens the page at the form with that topic chosen
    const topicSelect = form.elements.namedItem('topic');
    const preset = TOPIC_PRESETS[window.location.hash.slice(1)];
    if (preset && topicSelect) {
      topicSelect.value = preset;
      const target = form.parentElement.closest('[id]');
      if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'instant' }));
    }

    const setError = (input, show) => {
      input.setAttribute('aria-invalid', String(show));
      const err = document.getElementById(`${input.id}-err`);
      if (err) err.hidden = !show;
    };
    const check = (input) => {
      const value = input.value.trim();
      const valid = input.required ? value !== '' && input.checkValidity() : value === '' || input.checkValidity();
      setError(input, !valid);
      return valid;
    };
    // a link typed without https:// is completed rather than rejected
    const completeLink = (input) => {
      const value = input.value.trim();
      if (input.type === 'url' && value && !/^[a-z][a-z0-9+.-]*:/i.test(value) && /\.[a-z]{2,}/i.test(value)) {
        input.value = `https://${value}`;
      }
    };
    checked.forEach((input) => {
      input.addEventListener('blur', () => {
        completeLink(input);
        if (input.value) check(input);
      });
      input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') check(input); });
    });

    const showAlert = (message) => {
      alertBox.textContent = message || '';
      alertBox.hidden = !message;
    };
    const setSending = (sending) => {
      submitBtn.disabled = sending;
      submitBtn.classList.toggle('is-sending', sending);
      form.setAttribute('aria-busy', String(sending));
      if (submitLabel) submitLabel.textContent = sending ? 'Sending…' : idleLabel;
    };
    const showDone = () => {
      form.hidden = true;
      done.hidden = false;
      done.focus();
    };
    const subjectFor = (data) => (form.dataset.subject || '')
      .replace(/\{(\w+)\}/g, (match, key) => String(data.get(key) || '').trim() || 'General');
    const summary = (data) => {
      const lines = [`Subject: ${data.get('_subject')}`, ''];
      let message = '';
      [...form.elements].forEach((el) => {
        if (!el.name || el.name.startsWith('_') || el.type === 'submit' || el.closest('.hp')) return;
        const value = String(data.get(el.name) || '').trim();
        if (!value) return;
        if (el.tagName === 'TEXTAREA') { message = value; return; }
        const label = form.querySelector(`label[for="${el.id}"]`);
        lines.push(`${label ? label.firstChild.textContent.trim() : el.name}: ${value}`);
      });
      if (message) lines.push('', message);
      return lines.join('\n');
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitBtn.disabled) return;
      showAlert('');
      let firstBad = null;
      checked.forEach((input) => {
        completeLink(input);
        if (!check(input) && !firstBad) firstBad = input;
      });
      if (firstBad) { firstBad.focus(); return; }

      const data = new FormData(form);
      if (form.dataset.subject) data.set('_subject', subjectFor(data));

      if (isPreview) {
        const preview = done.querySelector('[data-form-preview]');
        if (preview) preview.textContent = summary(data);
        showDone();
        return;
      }
      if (typeof window.fetch !== 'function') { form.submit(); return; }

      setSending(true);
      try {
        const response = await fetch(form.action, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
        if (response.ok) {
          const replyTo = done.querySelector('[data-reply-to]');
          if (replyTo) replyTo.textContent = String(data.get('email'));
          form.reset();
          showDone();
          return;
        }
        // Formspree answers 4xx with { errors: [{ field, message }] }; mark the fields we know about.
        const result = await response.json().catch(() => ({}));
        const badFields = (Array.isArray(result.errors) ? result.errors : [])
          .map((err) => err.field && form.elements.namedItem(err.field))
          .filter((input) => input && document.getElementById(`${input.id}-err`));
        badFields.forEach((input) => setError(input, true));
        if (badFields.length) {
          showAlert('Please check the highlighted fields and try again.');
          badFields[0].focus();
        } else {
          showAlert(alertBox.dataset.fail);
        }
      } catch (error) {
        showAlert(alertBox.dataset.fail);
      } finally {
        setSending(false);
      }
    });

    done.querySelectorAll('[data-form-reset]').forEach((btn) => btn.addEventListener('click', () => {
      done.hidden = true;
      form.hidden = false;
      form.querySelector('input, select, textarea').focus();
    }));
  });

  /* ---------- Links to a section (services.html#drilling) open at that section ---------- */
  const hashTarget = window.location.hash.length > 1 && document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  if (hashTarget) requestAnimationFrame(() => hashTarget.scrollIntoView({ block: 'start', behavior: 'instant' }));

  /* ---------- Footer year ---------- */
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
})();
