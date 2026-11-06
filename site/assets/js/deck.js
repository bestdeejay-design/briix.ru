/* ============================================================
   BRIIX — presentation deck controller
   ============================================================ */
(function () {
  'use strict';

  const slides = Array.from(document.querySelectorAll('.slide'));
  if (!slides.length) return;

  const progressBar = document.getElementById('deck-progress-bar');
  const counter = document.getElementById('deck-counter');
  const prevBtn = document.getElementById('deck-prev');
  const nextBtn = document.getElementById('deck-next');
  let current = 0;

  function clamp(n) {
    return Math.max(0, Math.min(slides.length - 1, n));
  }

  function render() {
    slides.forEach((s, i) => {
      s.classList.toggle('active', i === current);
      s.setAttribute('aria-hidden', i === current ? 'false' : 'true');
    });
    if (progressBar) {
      progressBar.style.width = ((current + 1) / slides.length) * 100 + '%';
    }
    if (counter) {
      counter.textContent = (current + 1) + ' / ' + slides.length;
    }
    const hash = '#slide-' + (current + 1);
    if (location.hash !== hash) {
      history.replaceState(null, '', hash);
    }
  }

  function go(n) {
    const next = clamp(n);
    if (next === current) return;
    current = next;
    render();
  }

  /* Hash deep-link */
  const m = (location.hash || '').match(/^#slide-(\d+)$/);
  if (m) current = clamp(parseInt(m[1], 10) - 1);

  if (prevBtn) prevBtn.addEventListener('click', () => go(current - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => go(current + 1));

  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        go(current + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        go(current - 1);
        break;
      case 'Home':
        e.preventDefault();
        go(0);
        break;
      case 'End':
        e.preventDefault();
        go(slides.length - 1);
        break;
      default:
        break;
    }
  });

  /* Click zones (left third = back, right two thirds = forward) */
  document.getElementById('deck').addEventListener('click', (e) => {
    if (e.target.closest('a, button, .deck-controls')) return;
    const x = e.clientX / window.innerWidth;
    if (x < 0.28) go(current - 1);
    else go(current + 1);
  });

  /* Touch swipe */
  let touchX = null;
  window.addEventListener('touchstart', (e) => {
    touchX = e.changedTouches[0].clientX;
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 48) go(current + (dx < 0 ? 1 : -1));
    touchX = null;
  }, { passive: true });

  render();
})();
