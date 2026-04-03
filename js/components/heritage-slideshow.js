/* ============================================================
   heritage-slideshow.js — Heritage page gallery slideshow
   Loads heritage.items from featured-creations.json and
   converts the static .slideshow-placeholder into a live
   auto-advancing slideshow.
   ============================================================ */

(function () {
  'use strict';

  const DATA_URL          = '/data/featured-creations.json';
  const AUTO_ADVANCE_MS   = 4500;
  const PAUSE_ON_CLICK_MS = 6000;

  function init() {
    const wrapper = document.querySelector('.slideshow-placeholder');
    if (!wrapper) return;

    fetch(DATA_URL)
      .then(r => {
        if (!r.ok) throw new Error('fetch failed');
        return r.json();
      })
      .then(data => {
        const items = (data.heritage && Array.isArray(data.heritage.items))
          ? data.heritage.items.filter(item => item.enabled)
          : [];
        if (items.length === 0) return; // no data — leave placeholder as-is
        buildSlideshow(wrapper, items);
      })
      .catch(() => { /* network or parse error — leave placeholder as-is */ });
  }

  function resolveImage(item) {
    return item.imageMode === 'remote' ? item.remoteImage : item.localImage;
  }

  function buildSlideshow(wrapper, items) {
    let current   = 0;
    let autoTimer = null;

    const frame         = wrapper.querySelector('.slideshow-placeholder__frame');
    const dotsContainer = wrapper.querySelector('.slideshow-dots');

    // Replace the static placeholder contents with a live <img>
    frame.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'slideshow-img';
    img.alt       = items[0].alt || '';
    img.src       = resolveImage(items[0]);
    frame.appendChild(img);

    // Rebuild dots to match enabled item count
    dotsContainer.innerHTML = '';
    items.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'slideshow-dot' + (i === 0 ? ' slideshow-dot--active' : '');
      dotsContainer.appendChild(dot);
    });

    const dots = () => dotsContainer.querySelectorAll('.slideshow-dot');

    function goTo(idx) {
      current = (idx + items.length) % items.length;
      const item = items[current];
      img.alt = item.alt || '';
      img.src = resolveImage(item);
      dots().forEach((dot, i) => {
        dot.classList.toggle('slideshow-dot--active', i === current);
      });
    }

    function startAuto() {
      clearInterval(autoTimer);
      autoTimer = setInterval(() => goTo(current + 1), AUTO_ADVANCE_MS);
    }

    function pauseThenResume() {
      clearInterval(autoTimer);
      autoTimer = setTimeout(startAuto, PAUSE_ON_CLICK_MS);
    }

    // Click left half of frame → previous; right half → next
    frame.addEventListener('click', e => {
      const rect   = frame.getBoundingClientRect();
      const isLeft = (e.clientX - rect.left) < rect.width / 2;
      goTo(isLeft ? current - 1 : current + 1);
      pauseThenResume();
    });

    startAuto();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
