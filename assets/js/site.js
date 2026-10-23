/* MK Energies — shared site behaviour (no dependencies) */
(() => {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#04121F' : '#FFFFFF');
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
    window.matchMedia('(min-width: 901px)').addEventListener('change', (mq) => {
      if (mq.matches && !menu.hidden) closeMenu(false);
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
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
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

  /* ---------- Hero parallax (pointer devices only) ---------- */
  const parallax = document.querySelector('[data-parallax]');
  if (parallax && !reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    const zone = parallax.closest('section') || parallax;
    let frame = 0;
    let px = 0;
    let py = 0;
    zone.addEventListener('pointermove', (event) => {
      const rect = zone.getBoundingClientRect();
      px = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      py = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        parallax.style.setProperty('--px', px.toFixed(3));
        parallax.style.setProperty('--py', py.toFixed(3));
      });
    });
    zone.addEventListener('pointerleave', () => {
      parallax.style.setProperty('--px', '0');
      parallax.style.setProperty('--py', '0');
    });
  }

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

  /* ---------- Enquiry form: sends to Formspree on the live site; the Artifact copy only previews ---------- */
  const form = document.getElementById('enquiry-form');
  if (form) {
    const done = document.getElementById('enquiry-done');
    const alertBox = document.getElementById('enquiry-error');
    const submitBtn = form.querySelector('[type="submit"]');
    const submitLabel = submitBtn.querySelector('[data-submit-label]');
    const topicSelect = document.getElementById('f-topic');
    const isPreview = form.hasAttribute('data-preview');
    const presets = {
      dealer: 'Becoming a distributor or dealer',
      bulk: 'Bulk or industrial LPG supply',
      cylinders: 'Cylinder supply for home or business',
      careers: 'Careers'
    };
    // #enquiry, or a topic preset such as #dealer, opens the page at the form
    const hash = window.location.hash.slice(1);
    const preset = presets[hash];
    if (preset && topicSelect) topicSelect.value = preset;
    if (preset || hash === 'enquiry') {
      const target = document.getElementById('enquiry');
      if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'instant' }));
    }

    const setError = (input, show) => {
      input.setAttribute('aria-invalid', String(show));
      const err = document.getElementById(`${input.id}-err`);
      if (err) err.hidden = !show;
    };
    const check = (input) => {
      const valid = input.checkValidity() && input.value.trim() !== '';
      setError(input, !valid);
      return valid;
    };
    form.querySelectorAll('[required]').forEach((input) => {
      input.addEventListener('blur', () => { if (input.value) check(input); });
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
      if (submitLabel) submitLabel.textContent = sending ? 'Sending…' : 'Send enquiry';
    };
    const showDone = () => {
      form.hidden = true;
      done.hidden = false;
      done.focus();
    };
    const summary = (data) => {
      const lines = [`Subject: ${data.get('_subject')}`, ''];
      [['name', 'Name'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone'], ['topic', 'Topic']].forEach(([key, label]) => {
        const value = String(data.get(key) || '').trim();
        if (value) lines.push(`${label}: ${value}`);
      });
      lines.push('', String(data.get('message') || '').trim());
      return lines.join('\n');
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitBtn.disabled) return;
      showAlert('');
      let firstBad = null;
      form.querySelectorAll('[required]').forEach((input) => {
        if (!check(input) && !firstBad) firstBad = input;
      });
      if (firstBad) { firstBad.focus(); return; }

      const data = new FormData(form);
      data.set('_subject', `Website enquiry: ${String(data.get('topic') || 'General enquiry')}`);

      if (isPreview) {
        const preview = done.querySelector('[data-enquiry-preview]');
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

    document.querySelectorAll('[data-enquiry-reset]').forEach((btn) => btn.addEventListener('click', () => {
      done.hidden = true;
      form.hidden = false;
      form.querySelector('input, select, textarea').focus();
    }));
  }

  /* ---------- Footer year ---------- */
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
})();
