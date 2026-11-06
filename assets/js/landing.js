/* ============================================================
   BRIIX — landing interactions
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Header shadow on scroll ---------- */
  const header = document.querySelector('.site-header');
  const onScroll = () => {
    if (header) header.classList.toggle('scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile nav ---------- */
  const burger = document.querySelector('.burger');
  const nav = document.querySelector('.nav');
  if (burger && nav) {
    burger.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) {
        nav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll('.faq-item').forEach((item) => {
    const q = item.querySelector('.faq-q');
    const a = item.querySelector('.faq-a');
    if (!q || !a) return;
    q.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach((other) => {
        if (other !== item) {
          other.classList.remove('open');
          const oa = other.querySelector('.faq-a');
          if (oa) oa.style.maxHeight = '0px';
        }
      });
      item.classList.toggle('open', !isOpen);
      a.style.maxHeight = isOpen ? '0px' : a.scrollHeight + 'px';
    });
  });

  /* ============================================================
     Demo content — provided by assets/i18n/ru.js or en.js
     ============================================================ */
  const I18N = window.I18N || {};
  const UI = I18N.ui || {};
  const BRANDS = (I18N.demo && I18N.demo.brands) || {};

  /* Generic dataset for any other domain — personalized by name */
  function genericBrand(domain, name, palette) {
    const g = (I18N.demo && I18N.demo.generic) || {};
    const fill = (s) => (s || '').replace(/\{brand\}/g, name).replace(/\{domain\}/g, domain);
    return {
      name,
      kind: fill(g.kind),
      desc: fill(g.desc),
      tone: g.tone || [],
      palette,
      schedule: g.schedule || '',
      channels: g.channels || '',
      plan: (g.plan || []).map((row) => [fill(row[0]), row[1]]),
      posts: (g.posts || []).map((p) => ({
        tag: p.tag,
        chip: p.chip,
        dark: p.dark,
        art: [palette[p.art[0]] || palette[0], palette[p.art[1]] || palette[1]],
        artTitle: fill(p.artTitle),
        title: fill(p.title),
        caption: fill(p.caption),
        captionBiz: fill(p.captionBiz),
        captionChat: fill(p.captionChat),
        tags: p.tags,
        cta: fill(p.cta),
      })),
    };
  }

  /* ---------- Color helpers (demo palette generation) ---------- */
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
    return '#' + to(f(0)) + to(f(8)) + to(f(4));
  }

  function paletteFor(domain) {
    const h = hashStr(domain.toLowerCase());
    const hue = h % 360;
    return {
      primary: hslToHex(hue, 62 + (h % 12), 38),
      secondary: hslToHex((hue + 26) % 360, 55, 56),
      accent: hslToHex((hue + 185) % 360, 72, 58),
      bg: hslToHex(hue, 38, 95),
      text: hslToHex(hue, 30, 16),
      blob1: 'rgba(255, 255, 255, 0.22)',
      blob2: 'rgba(255, 255, 255, 0.14)',
    };
  }

  function brandFor(domain) {
    const d = domain.toLowerCase();
    if (BRANDS[d]) return BRANDS[d];
    const h = hashStr(d);
    const keys = Object.keys(BRANDS);
    const template = BRANDS[keys[h % keys.length]];
    const name = (d.replace(/^(www\.)?/, '').split('.')[0] || 'Brand').replace(/(^|[-_])(\w)/g, (m, a, b) => b.toUpperCase()).slice(0, 14);
    const palette = paletteFor(d);
    return genericBrand(d, name, [
      palette.primary, palette.secondary, palette.accent, palette.bg, palette.text,
    ]);
  }

  /* ---------- Demo UI wiring ---------- */
  const demoForm = document.getElementById('demo-form');
  const demoInput = document.getElementById('demo-url');
  const demoIdle = document.getElementById('demo-idle');
  const demoGen = document.getElementById('demo-gen');
  const demoResult = document.getElementById('demo-result');
  const demoUrlChip = document.getElementById('demo-url-chip');
  const demoDomainOut = document.getElementById('demo-domain');
  const stepsEl = demoGen ? demoGen.querySelectorAll('.gen-step') : [];
  const postsGrid = document.getElementById('demo-posts');
  const brandCardBox = document.getElementById('demo-brand');
  const planTeaser = document.getElementById('demo-plan');

  let currentBrand = null;
  let lastDomain = 'nordhavn-studio.com';
  const WHEN = UI.when || [];

  function renderPreview(domain) {
    const brand = brandFor(domain);
    currentBrand = brand;
    const p = brand.palette;
    const name = brand.name;

    if (brandCardBox) {
      brandCardBox.innerHTML = `
        <div class="bc-top">
          <div class="bc-title">
            <div class="brand-logo-sq" style="background:${p[0]}">${name.charAt(0)}</div>
            <div>
              <div class="bc-name">${name}</div>
              <div class="bc-desc">${brand.kind} · ${UI.brandDnaVersion}</div>
            </div>
          </div>
          <div class="dna-chips"><span class="dna-chip accent">${UI.selfCheck}</span></div>
        </div>
        <div class="dna-chips">${brand.tone.map((t) => `<span class="dna-chip">${t}</span>`).join('')}<span class="dna-chip">${brand.schedule || ''}</span></div>
        <div class="palette-row">
          ${p.map((c) => `<span class="sw" style="background:${c}"></span>`).join('')}
          <span class="lbl">${brand.desc}</span>
        </div>`;
    }

    if (postsGrid) {
      postsGrid.innerHTML = brand.posts.map((post, i) => {
        const bg1 = post.art[0];
        const bg2 = post.art[1];
        return `
        <article class="post-mini" tabindex="0" role="button" data-post-index="${i}" aria-label="${UI.openPost}${post.title.replace(/"/g, '')}">
          <div class="pm-canvas">
            <span class="wm">${UI.watermark}</span>
            <div class="pm-art${post.img ? ' has-img' : ''}" style="background:linear-gradient(${140 + i * 23}deg, ${bg1}, ${bg2})">
              ${post.img ? `<img class="pa-img" src="${post.img}" alt="" loading="lazy">` : ''}
              <div class="pa-blob" style="width:70px;height:70px;top:${-12 + i * 4}px;right:${-16 + i * 3}px"></div>
              <div class="pa-blob" style="width:44px;height:44px;bottom:${28 + i * 2}px;left:${-10}px"></div>
              <span class="pa-chip${post.dark ? ' dark' : ''}">${post.chip}</span>
              <div class="pa-title${post.dark ? ' dark' : ''}">${post.artTitle}</div>
            </div>
          </div>
          <div class="pm-meta">
            <div class="pm-tag">${post.tag} · ${WHEN[i % WHEN.length]}</div>
            <div class="pm-title">${post.title}</div>
            <div class="pm-excerpt">${(post.caption.split('\n')[0] || '')}</div>
          </div>
        </article>`;
      }).join('');
    }

    if (planTeaser) {
      planTeaser.hidden = false;
      const ptItems = planTeaser.querySelector('.pt-items');
      if (ptItems && brand.plan) {
        ptItems.innerHTML = brand.plan.map((row, idx) => `
          <div class="pt-item${idx > 4 ? ' locked' : ''}"><i class="pt-num">${String(7 + idx).padStart(2, '0')}</i><div><b>${row[0]}</b><span>${row[1]}</span></div></div>`).join('');
      }
    }
  }

  /* ---------- Post detail modal ---------- */
  const modal = document.getElementById('post-modal');
  const modalArt = document.getElementById('pm-visual');
  const modalRubric = document.getElementById('pm-rubric');
  const modalTitle = document.getElementById('pm-title');
  const modalCaption = document.getElementById('pm-caption');
  const modalTags = document.getElementById('pm-tags');
  const modalCta = document.getElementById('pm-cta');
  let modalPost = null;
  let modalWhen = '';
  let modalChannel = 'feed';

  function renderModal() {
    if (!modalPost) return;
    const variants = {
      feed: modalPost.caption,
      biz: modalPost.captionBiz,
      chat: modalPost.captionChat,
    };
    if (modalArt) {
      modalArt.innerHTML = `
        <div class="pm-art-big pm-art${modalPost.img ? ' has-img' : ''}" style="background:linear-gradient(150deg, ${modalPost.art[0]}, ${modalPost.art[1]})">
          ${modalPost.img ? `<img class="pa-img" src="${modalPost.img}" alt="" loading="lazy">` : ''}
          <div class="pa-blob" style="width:120px;height:120px;top:-24px;right:-20px"></div>
          <div class="pa-blob" style="width:80px;height:80px;bottom:40px;left:-24px"></div>
          <span class="pa-chip${modalPost.dark ? ' dark' : ''}">${modalPost.chip}</span>
          <div class="pa-title${modalPost.dark ? ' dark' : ''}" style="font-size:26px">${modalPost.artTitle}</div>
          <span class="wm" style="top:12px;right:12px">${UI.watermarkBriix}</span>
        </div>`;
    }
    const ch = (currentBrand && currentBrand.channels) || 'Instagram · Facebook · LinkedIn · Telegram';
    if (modalRubric) modalRubric.innerHTML = `<span class="dna-chip accent">${modalPost.tag}</span><span class="dna-chip">${UI.calendarPrefix}${modalWhen}</span><span class="dna-chip">${UI.channelsPrefix}${ch}</span><span class="dna-chip">${UI.factCheck}</span>`;
    if (modalTitle) modalTitle.textContent = modalPost.title;
    if (modalCaption) modalCaption.textContent = variants[modalChannel] || modalPost.caption;
    if (modalTags) modalTags.innerHTML = modalPost.tags.map((t) => `<span>${t}</span>`).join('');
    if (modalCta) modalCta.textContent = modalPost.cta;
    document.querySelectorAll('.pm-tab').forEach((tab) => {
      tab.classList.toggle('on', tab.getAttribute('data-channel') === modalChannel);
    });
  }

  function openModal(index) {
    if (!modal || !currentBrand) return;
    modalPost = currentBrand.posts[index];
    modalWhen = WHEN[index % WHEN.length];
    modalChannel = 'feed';
    renderModal();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    modalPost = null;
  }

  if (postsGrid) {
    postsGrid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-post-index]');
      if (card) openModal(+card.getAttribute('data-post-index'));
    });
    postsGrid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('[data-post-index]');
      if (card) {
        e.preventDefault();
        openModal(+card.getAttribute('data-post-index'));
      }
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-modal]')) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
    });
    modal.querySelectorAll('.pm-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        modalChannel = tab.getAttribute('data-channel');
        renderModal();
      });
    });
    modal.querySelectorAll('.pm-act').forEach((btn) => {
      btn.addEventListener('click', () => {
        const msg = document.getElementById('toast');
        if (!msg) return;
        const label = btn.getAttribute('data-toast') || UI.toastDefault || '';
        msg.firstChild.textContent = label + (UI.toastSuffix || '');
        msg.hidden = false;
        msg.style.opacity = '1';
        clearTimeout(msg._t);
        msg._t = setTimeout(() => {
          msg.style.opacity = '0';
          setTimeout(() => (msg.hidden = true), 350);
        }, 3200);
      });
    });
  }

  /* ---------- URL demo flow ---------- */
  function normalizeUrl(raw) {
    let v = (raw || '').trim();
    if (!v) return null;
    v = v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\s+/g, '');
    if (!v || v.indexOf('.') === -1 || /\s/.test(v)) return null;
    return v;
  }

  function show(el) {
    if (el) el.hidden = false;
  }
  function hide(el) {
    if (el) el.hidden = true;
  }

  let running = false;

  function runDemo(domain) {
    if (running) return;
    running = true;
    lastDomain = domain;

    hide(demoIdle);
    hide(demoResult);
    show(demoGen);
    if (demoUrlChip) demoUrlChip.textContent = domain;
    if (demoDomainOut) demoDomainOut.textContent = domain;

    stepsEl.forEach((s) => {
      s.classList.remove('active', 'done');
      const mark = s.querySelector('.mark');
      if (mark) mark.textContent = '';
    });

    const durations = [850, 900, 850, 950, 1150];
    let t = 350;
    stepsEl.forEach((step, idx) => {
      setTimeout(() => {
        step.classList.add('active');
        if (idx > 0) {
          stepsEl[idx - 1].classList.remove('active');
          stepsEl[idx - 1].classList.add('done');
          const mark = stepsEl[idx - 1].querySelector('.mark');
          if (mark) mark.textContent = '✓';
        }
      }, t);
      t += durations[idx] || 900;
    });

    setTimeout(() => {
      const last = stepsEl[stepsEl.length - 1];
      if (last) {
        last.classList.remove('active');
        last.classList.add('done');
        const mark = last.querySelector('.mark');
        if (mark) mark.textContent = '✓';
      }
      renderPreview(domain);
      hide(demoGen);
      show(demoResult);
      running = false;
    }, t + 250);
  }

  if (demoForm) {
    demoForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const domain = normalizeUrl(demoInput && demoInput.value);
      if (!domain) {
        if (demoInput) {
          demoInput.focus();
          const wrap = demoInput.closest('.url-input-wrap');
          if (wrap) {
            wrap.classList.add('error');
            setTimeout(() => wrap.classList.remove('error'), 1200);
          }
        }
        return;
      }
      runDemo(domain);
      const anchor = document.getElementById('demo');
      if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  document.querySelectorAll('[data-try-domain]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = btn.getAttribute('data-try-domain');
      if (demoInput) demoInput.value = d;
      runDemo(d);
    });
  });

  /* Auto-show: the demo is always filled with real content once it is seen */
  const demoCard = document.querySelector('.demo-card');
  if (demoCard && 'IntersectionObserver' in window) {
    const dio = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting) && demoIdle && !demoIdle.hidden && !running) {
        dio.disconnect();
        runDemo('nordhavn-studio.com');
      }
    }, { threshold: 0.2 });
    dio.observe(demoCard);
  }

  const restartBtn = document.getElementById('demo-restart');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      runDemo(lastDomain);
    });
  }

  const changeBtn = document.getElementById('demo-change');
  if (changeBtn) {
    changeBtn.addEventListener('click', () => {
      hide(demoGen);
      hide(demoResult);
      if (planTeaser) planTeaser.hidden = true;
      stepsEl.forEach((s) => {
        s.classList.remove('active', 'done');
        const mark = s.querySelector('.mark');
        if (mark) mark.textContent = '';
      });
      if (demoInput) demoInput.focus();
    });
  }

  /* Toast for CTA placeholders */
  document.querySelectorAll('[data-cta-toast]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (btn.tagName === 'A' && btn.getAttribute('href') && btn.getAttribute('href') !== '#') return;
      e.preventDefault();
      const msg = document.getElementById('toast');
      if (!msg) return;
      msg.hidden = false;
      msg.style.opacity = '1';
      clearTimeout(msg._t);
      msg._t = setTimeout(() => {
        msg.style.opacity = '0';
        setTimeout(() => (msg.hidden = true), 350);
      }, 3200);
    });
  });

  /* ---------- Smooth anchor offset for sticky header ---------- */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#' || id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const y = target.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top: y, behavior: 'smooth' });
    });
  });
})();
