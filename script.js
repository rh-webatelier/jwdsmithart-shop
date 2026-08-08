// JWD Smith Art — nav, sticky header, reveal, lightbox, lazy fade
(function () {
  document.documentElement.classList.add('js');
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('primary-nav');
  var header = document.getElementById('site-header');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  if (header) {
    var onScroll = function () { header.classList.toggle('is-stuck', window.scrollY > 40); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { obs.observe(el); });
    document.querySelectorAll('.hero .reveal').forEach(function (el) { el.classList.add('is-visible'); });
    window.addEventListener('load', function () {
      setTimeout(function () { revealEls.forEach(function (el) { el.classList.add('is-visible'); }); }, 1400);
    });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  // lazy image fade
  var lazy = Array.prototype.slice.call(document.querySelectorAll('img[loading="lazy"]'));
  lazy.forEach(function (img) {
    if (img.complete) img.classList.add('is-loaded');
    else {
      img.addEventListener('load', function () { img.classList.add('is-loaded'); }, { once: true });
      img.addEventListener('error', function () { img.classList.add('is-loaded'); }, { once: true });
    }
  });
  window.addEventListener('load', function () { lazy.forEach(function (i) { i.classList.add('is-loaded'); }); });

  // lightbox over the paintings
  var frames = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
  if (frames.length) {
    var idx = 0, box = null;
    function build() {
      box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      box.innerHTML = '<button class="lightbox__close" aria-label="Close">×</button>'
        + '<button class="lightbox__nav lightbox__nav--prev" aria-label="Previous">‹</button>'
        + '<img alt=""><div class="lightbox__cap"></div>'
        + '<button class="lightbox__nav lightbox__nav--next" aria-label="Next">›</button>';
      document.body.appendChild(box);
      box.querySelector('.lightbox__close').addEventListener('click', close);
      box.querySelector('.lightbox__nav--prev').addEventListener('click', function (e) { e.stopPropagation(); show(idx - 1); });
      box.querySelector('.lightbox__nav--next').addEventListener('click', function (e) { e.stopPropagation(); show(idx + 1); });
      box.addEventListener('click', function (e) { if (e.target === box) close(); });
      var x0 = null;
      box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      box.addEventListener('touchend', function (e) {
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 45) show(idx + (dx < 0 ? 1 : -1));
        x0 = null;
      });
      document.addEventListener('keydown', function (e) {
        if (!box || !box.classList.contains('is-open')) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowRight') show(idx + 1);
        else if (e.key === 'ArrowLeft') show(idx - 1);
      });
    }
    function show(i) {
      idx = (i + frames.length) % frames.length;
      var f = frames[idx];
      var img = f.querySelector('img');
      box.querySelector('img').src = img.getAttribute('src');
      box.querySelector('.lightbox__cap').innerHTML =
        '<b>' + (f.getAttribute('data-title') || '') + '</b><span>' + (f.getAttribute('data-meta') || '') + '</span>';
    }
    function open(i) { if (!box) build(); show(i); box.classList.add('is-open'); document.body.style.overflow = 'hidden'; }
    function close() { if (box) { box.classList.remove('is-open'); document.body.style.overflow = ''; } }
    frames.forEach(function (f, i) { f.addEventListener('click', function () { open(i); }); });
  }
})();

// Buy Now buttons — redirect to each painting's Stripe Payment Link.
// Until a real link is pasted into data-stripe-link, the button is inert (no dead click errors).
(function () {
  document.querySelectorAll('.buy-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      var link = btn.getAttribute('data-stripe-link');
      if (link) {
        window.location.href = link;
      } else {
        e.preventDefault();
      }
    });
  });
})();
