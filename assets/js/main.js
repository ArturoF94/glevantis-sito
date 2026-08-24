// Glevantis — script principale. Vanilla JS, nessuna dipendenza.

document.documentElement.classList.add('js');

(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.main-nav');

  if (!toggle || !nav) return;

  toggle.addEventListener('click', function () {
    var isOpen = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  nav.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
})();

// Header: ombra leggera dopo il primo scroll.
(function () {
  var header = document.querySelector('.site-header');
  if (!header) return;

  var update = function () {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
})();

// Reveal on scroll: elementi con classe .reveal appaiono quando entrano in viewport.
(function () {
  var targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;

  if (!('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );

  targets.forEach(function (el, i) {
    el.style.setProperty('--reveal-delay', Math.min(i % 3, 2) * 80 + 'ms');
    observer.observe(el);
  });
})();

// Carousel dei casi: scorrimento con frecce, una card alla volta.
(function () {
  document.querySelectorAll('.case-carousel-wrap').forEach(function (wrap) {
    var track = wrap.querySelector('.case-carousel');
    var prev = wrap.querySelector('.carousel-nav-prev');
    var next = wrap.querySelector('.carousel-nav-next');
    if (!track || !prev || !next) return;

    var scrollByCard = function (dir) {
      var card = track.querySelector(':scope > *');
      var gap = 20;
      var amount = card ? card.getBoundingClientRect().width + gap : 300;
      track.scrollBy({ left: dir * amount, behavior: 'smooth' });
    };

    prev.addEventListener('click', function () { scrollByCard(-1); });
    next.addEventListener('click', function () { scrollByCard(1); });

    var updateNavState = function () {
      var max = track.scrollWidth - track.clientWidth - 4;
      prev.disabled = track.scrollLeft <= 4;
      next.disabled = track.scrollLeft >= max;
    };

    track.addEventListener('scroll', updateNavState, { passive: true });
    updateNavState();
  });
})();
