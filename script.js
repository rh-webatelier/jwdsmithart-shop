// JWD Smith Art — nav, sticky header, reveal, lightbox, lazy fade
var revealObserver = null;

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

  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); revealObserver.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
  }

  function observeReveal(el) {
    if (revealObserver) revealObserver.observe(el);
    else el.classList.add('is-visible');
  }
  window.observeReveal = observeReveal;

  var revealEls = document.querySelectorAll('.reveal');
  revealEls.forEach(function (el) { observeReveal(el); });
  document.querySelectorAll('.hero .reveal').forEach(function (el) { el.classList.add('is-visible'); });
  window.addEventListener('load', function () {
    setTimeout(function () { document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-visible'); }); }, 1400);
  });

  // lazy image fade
  function wireLazyFade(scope) {
    var lazy = Array.prototype.slice.call((scope || document).querySelectorAll('img[loading="lazy"]'));
    lazy.forEach(function (img) {
      if (img.complete) img.classList.add('is-loaded');
      else {
        img.addEventListener('load', function () { img.classList.add('is-loaded'); }, { once: true });
        img.addEventListener('error', function () { img.classList.add('is-loaded'); }, { once: true });
      }
    });
  }
  window.wireLazyFade = wireLazyFade;
  wireLazyFade(document);
})();

// Editable site text — content/site.json is edited via the CMS; each field maps to a data-cms element.
(function () {
  var els = document.querySelectorAll('[data-cms]');
  if (!els.length) return;
  fetch('content/site.json')
    .then(function (r) { return r.json(); })
    .then(function (site) {
      els.forEach(function (el) {
        var key = el.getAttribute('data-cms');
        if (site[key]) el.textContent = site[key];
      });
    })
    .catch(function () { /* keep the baked-in text already in the HTML */ });
})();

// Lightbox over the paintings — re-attached whenever the paintings grid (re)renders.
function initLightbox() {
  var frames = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
  if (!frames.length) return;
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

// Buy Now buttons.
// If a manual Stripe Payment Link was pasted into the CMS for this painting, use it as-is.
// Otherwise, ask our Netlify Function to create a Checkout Session on the fly from the
// painting's current title/price/photo — nothing to keep in sync in Stripe by hand.
function initBuyButtons() {
  document.querySelectorAll('.buy-btn').forEach(function (btn) {
    if (btn.classList.contains('is-disabled')) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var manualLink = btn.getAttribute('data-stripe-link');
      if (manualLink) { window.location.href = manualLink; return; }

      var original = btn.textContent;
      btn.textContent = 'Loading…';
      btn.classList.add('is-disabled');

      fetch('/.netlify/functions/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: btn.getAttribute('data-painting'),
          price: btn.getAttribute('data-price'),
          image: btn.getAttribute('data-image'),
          slug: btn.getAttribute('data-slug')
        })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (res.ok && res.data.url) { window.location.href = res.data.url; return; }
          throw new Error(res.data && res.data.error || 'checkout_unavailable');
        })
        .catch(function () {
          btn.textContent = original;
          btn.classList.remove('is-disabled');
          var work = btn.closest('.work');
          var ask = work && work.querySelector('.work__ask');
          if (ask) window.location.href = ask.href;
        });
    });
  });
}

// Mobile "See all paintings" — collapses to the first 4 on phones; desktop always shows the full grid.
function initWorksToggle() {
  var toggle = document.querySelector('.works-toggle');
  var works = document.querySelector('.works');
  if (!toggle || !works) return;
  works.classList.add('is-collapsed');
  var MORE = toggle.getAttribute('data-label-more') || 'See all paintings';
  var LESS = toggle.getAttribute('data-label-less') || 'Show fewer paintings';
  toggle.addEventListener('click', function () {
    var collapsed = works.classList.toggle('is-collapsed');
    toggle.textContent = collapsed ? MORE : LESS;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed) {
      works.querySelectorAll('.work--extra.reveal').forEach(function (el) { el.classList.add('is-visible'); });
    } else {
      toggle.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
}

// Paintings grid — rendered from content/paintings.json so the Netlify CMS admin
// (add / edit / remove / reorder / mark sold) is reflected on the live site with no code changes.
(function () {
  var grid = document.getElementById('works-grid');
  if (!grid) return;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Fallback so a painting added via the CMS without a manually-set slug still gets a
  // working Buy button and can still be found by the Stripe webhook after a sale.
  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function cardHTML(p, i) {
    var extraClass = i >= 4 ? ' work--extra' : '';
    var title = escapeHtml(p.title || '');
    var medium = escapeHtml(p.medium || '');
    var meta = medium + ' · £' + p.price;
    var subject = encodeURIComponent(p.title || '');
    var stripeLink = p.stripe_link || '';
    var href = stripeLink || '#';
    var slug = p.slug || slugify(p.title || '');
    return (
      '<article class="work reveal' + extraClass + '">' +
        '<div class="work__frame" data-lightbox data-title="' + title + '" data-meta="' + escapeHtml(meta) + '">' +
          '<img src="' + escapeHtml(p.image) + '" alt="' + title + ' — original oil painting by Jonathan Smith" loading="lazy" />' +
          '<span class="work__zoom" aria-hidden="true">&#9906;</span>' +
        '</div>' +
        '<div class="work__body">' +
          '<h3 class="work__title">' + title + '</h3>' +
          '<p class="work__meta">' + medium + '</p>' +
          '<div class="work__foot">' +
            '<div class="work__price"><small>Original</small>£' + p.price + '</div>' +
            '<div class="work__buy">' +
              '<a class="btn btn--sm buy-btn" href="' + escapeHtml(href) + '" data-stripe-link="' + escapeHtml(stripeLink) + '" data-painting="' + title + '" data-price="' + p.price + '" data-image="' + escapeHtml(p.image) + '" data-slug="' + escapeHtml(slug) + '">Buy Now</a>' +
              '<a class="work__ask" href="mailto:jwdsmithart@mail.co.uk?subject=Question:%20' + subject + '">Ask a question</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  fetch('content/paintings.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      // Sold paintings live only in the Sold Works section below — once bought, a piece
      // comes off the For Sale catalogue entirely rather than lingering there as "Sold".
      var paintings = (data.paintings || []).filter(function (p) { return !p.sold; });
      var html = paintings.map(cardHTML).join('');
      if (paintings.length > 4) {
        var n = paintings.length;
        html += '<button type="button" class="works-toggle" data-label-more="See all ' + n + ' paintings" '
          + 'data-label-less="Show fewer paintings" aria-expanded="false">See all ' + n + ' paintings</button>';
      }
      grid.innerHTML = html;
      grid.removeAttribute('data-loading');

      grid.querySelectorAll('.reveal').forEach(function (el) {
        if (window.observeReveal) window.observeReveal(el); else el.classList.add('is-visible');
      });
      if (window.wireLazyFade) window.wireLazyFade(grid);

      initLightbox();
      initBuyButtons();
      initWorksToggle();
    })
    .catch(function () {
      grid.innerHTML = '<p class="works-loading">Couldn\'t load paintings right now — please refresh, or ' +
        '<a href="mailto:jwdsmithart@mail.co.uk">email me</a> and I\'ll send photos directly.</p>';
    });
})();

// Sold Works gallery — same content/paintings.json, filtered to sold:true. Recently-sold
// paintings (bought through Buy Now) land here automatically once the Stripe webhook
// flips their "sold" flag; older sold works can be seeded in directly via the CMS.
(function () {
  var section = document.getElementById('sold-works');
  var grid = document.getElementById('sold-grid');
  if (!section || !grid) return;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function soldCardHTML(p) {
    var title = escapeHtml(p.title || '');
    var medium = escapeHtml(p.medium || '');
    return (
      '<figure class="sold-card reveal">' +
        '<img src="' + escapeHtml(p.image) + '" alt="' + title + ' — sold original oil painting by Jonathan Smith" loading="lazy" />' +
        '<span class="sold-card__tag">Sold</span>' +
        '<figcaption><b>' + title + '</b><span>' + medium + '</span></figcaption>' +
      '</figure>'
    );
  }

  fetch('content/paintings.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var sold = (data.paintings || []).filter(function (p) { return p.sold; });
      if (!sold.length) { section.hidden = true; return; }
      section.hidden = false;
      grid.innerHTML = sold.map(soldCardHTML).join('');
      grid.querySelectorAll('.reveal').forEach(function (el) {
        if (window.observeReveal) window.observeReveal(el); else el.classList.add('is-visible');
      });
      if (window.wireLazyFade) window.wireLazyFade(grid);
    })
    .catch(function () { section.hidden = true; });
})();

// Commission form — inline AJAX submit via formsubmit.co, falls back to a normal POST if fetch fails.
(function () {
  var form = document.querySelector('form.commission-form');
  if (!form || !window.fetch) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    fetch(form.action, { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json().catch(function () { return {}; }); })
      .then(function () {
        var ok = document.createElement('div');
        ok.className = 'form-success';
        ok.innerHTML = '<div class="form-success__check"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></div>'
          + '<h3>Thanks — message sent</h3><p>I’ll get back to you shortly to talk through the commission.</p>';
        form.replaceWith(ok);
      })
      .catch(function () { if (btn) { btn.disabled = false; btn.textContent = label; } form.submit(); });
  });
})();
