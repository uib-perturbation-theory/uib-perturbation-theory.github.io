/* =====================================================================
   Hero visualisation switcher: alternates black-hole lensing and BBH merger.
   ===================================================================== */
(function () {
  'use strict';

  const hero = document.getElementById('home-hero');
  const lens = document.getElementById('home-lens-canvas');
  const bbh = document.getElementById('home-bbh-canvas');
  const button = document.getElementById('hero-viz-toggle');

  if (!hero || !lens || !bbh || !button) return;

  const MODES = ['lens', 'bbh'];
  const stored = localStorage.getItem('hero-visualisation');
  let mode = MODES.includes(stored) ? stored : MODES[Math.floor(Math.random() * MODES.length)];

  function setMode(next, persist) {
    mode = next;
    const showLens = mode === 'lens';

    lens.hidden = !showLens;
    bbh.hidden = showLens;

    lens.classList.toggle('is-active', showLens);
    bbh.classList.toggle('is-active', !showLens);

    hero.dataset.visualisation = mode;
    button.textContent = showLens ? 'Show binary merger' : 'Show lensing view';
    button.setAttribute(
      'aria-label',
      showLens ? 'Switch hero visualisation to binary black hole merger' : 'Switch hero visualisation to black hole lensing'
    );

    if (window.HomeBBHMergerHero) {
      if (showLens) window.HomeBBHMergerHero.stop();
      else window.HomeBBHMergerHero.start();
    }

    if (persist) localStorage.setItem('hero-visualisation', mode);
  }

  button.addEventListener('click', () => {
    setMode(mode === 'lens' ? 'bbh' : 'lens', true);
  });

  // If the BBH script loads after this file, it will auto-start if visible.
  setMode(mode, false);
})();
