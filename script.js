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

// Lightbox over the paintings — a single shared instance. initLightbox() is called again
// whenever a grid (For Sale, Sold Works) finishes rendering, so it re-scans for any new
// [data-lightbox] frames and binds only the ones it hasn't seen yet — this is what lets sold
// paintings open in the same lightbox without creating duplicate overlays or click handlers.
var lightboxState = { box: null, frames: [], idx: 0 };

function buildLightboxBox() {
  var box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.innerHTML = '<button class="lightbox__close" aria-label="Close">×</button>'
    + '<button class="lightbox__nav lightbox__nav--prev" aria-label="Previous">‹</button>'
    + '<div class="lightbox__stage"><img alt="" /><span class="lightbox__zoom-hint">Tap the painting to zoom in</span></div>'
    + '<div class="lightbox__cap"><b></b><span class="lightbox__meta"></span><p class="lightbox__desc"></p></div>'
    + '<button class="lightbox__nav lightbox__nav--next" aria-label="Next">›</button>';
  document.body.appendChild(box);
  var img = box.querySelector('img');
  box.querySelector('.lightbox__close').addEventListener('click', closeLightbox);
  box.querySelector('.lightbox__nav--prev').addEventListener('click', function (e) { e.stopPropagation(); showLightbox(lightboxState.idx - 1); });
  box.querySelector('.lightbox__nav--next').addEventListener('click', function (e) { e.stopPropagation(); showLightbox(lightboxState.idx + 1); });
  box.addEventListener('click', function (e) { if (e.target === box) closeLightbox(); });

  // Click/tap the painting to zoom in on that spot; the image then tracks the pointer
  // so moving the mouse (or dragging a finger) pans around like a magnifying glass.
  // Click/tap again to zoom back out.
  // The reference rect is captured once, right before the image scales up, and reused
  // for the whole zoomed session — re-querying getBoundingClientRect() on an already
  // -scaled element feeds its own previous move back into the next one (the box grows
  // and shifts with transform-origin), which made the magnifier drift/invert near edges.
  var zoomBaseRect = null;
  function setZoomOrigin(clientX, clientY) {
    var r = zoomBaseRect || img.getBoundingClientRect();
    var px = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 100;
    var py = Math.max(0, Math.min(1, (clientY - r.top) / r.height)) * 100;
    img.style.transformOrigin = px + '% ' + py + '%';
  }
  img.addEventListener('click', function (e) {
    e.stopPropagation();
    var zoomed = !img.classList.contains('is-zoomed');
    if (zoomed) {
      zoomBaseRect = img.getBoundingClientRect();
      setZoomOrigin(e.clientX, e.clientY);
      img.classList.add('is-zoomed');
    } else {
      img.classList.remove('is-zoomed');
      img.style.transformOrigin = '';
      zoomBaseRect = null;
    }
  });
  img.addEventListener('mousemove', function (e) {
    if (img.classList.contains('is-zoomed')) setZoomOrigin(e.clientX, e.clientY);
  });
  img.addEventListener('touchmove', function (e) {
    if (img.classList.contains('is-zoomed') && e.touches[0]) {
      setZoomOrigin(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    }
  }, { passive: false });

  var x0 = null;
  box.addEventListener('touchstart', function (e) {
    if (img.classList.contains('is-zoomed')) return; // swiping pans while zoomed, not navigating
    x0 = e.touches[0].clientX;
  }, { passive: true });
  box.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 45) showLightbox(lightboxState.idx + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  document.addEventListener('keydown', function (e) {
    if (!lightboxState.box || !lightboxState.box.classList.contains('is-open')) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') showLightbox(lightboxState.idx + 1);
    else if (e.key === 'ArrowLeft') showLightbox(lightboxState.idx - 1);
  });
  lightboxState.box = box;
}

function showLightbox(i) {
  var frames = lightboxState.frames;
  lightboxState.idx = (i + frames.length) % frames.length;
  var f = frames[lightboxState.idx];
  var img = f.querySelector('img');
  var box = lightboxState.box;
  var lightboxImg = box.querySelector('img');
  lightboxImg.classList.remove('is-zoomed');
  lightboxImg.style.transformOrigin = '';
  lightboxImg.src = img.getAttribute('src');
  box.querySelector('.lightbox__cap b').textContent = f.getAttribute('data-title') || '';
  box.querySelector('.lightbox__meta').textContent = f.getAttribute('data-meta') || '';
  var desc = f.getAttribute('data-desc') || '';
  var descEl = box.querySelector('.lightbox__desc');
  descEl.textContent = desc;
  descEl.hidden = !desc;
}

function openLightbox(frame) {
  if (!lightboxState.box) buildLightboxBox();
  showLightbox(lightboxState.frames.indexOf(frame));
  lightboxState.box.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  if (lightboxState.box) {
    lightboxState.box.classList.remove('is-open');
    lightboxState.box.querySelector('img').classList.remove('is-zoomed');
    document.body.style.overflow = '';
  }
}

function initLightbox() {
  lightboxState.frames = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
  lightboxState.frames.forEach(function (f) {
    if (f.dataset.lightboxBound) return;
    f.dataset.lightboxBound = 'true';
    f.addEventListener('click', function () { openLightbox(f); });
  });
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

// How many cards show up front, and how many more each "Load more" click reveals —
// both bigger on desktop (wide grid, more room) than on phones. Used by both the For Sale
// catalogue and the Sold Works gallery so neither turns into a giant wall of cards at once.
var MOBILE_CAP = 4;
var DESKTOP_CAP = 12;
var LOAD_BATCH_MOBILE = 10;
var LOAD_BATCH_DESKTOP = 18;

// Incremental "Load more": reveals a batch of cards per click (not everything at once),
// keeps the button's label showing how many are still hidden, and shows a separate
// "Show fewer" link — as soon as more than the initial count is visible, not only once
// everything has been loaded — so a visitor can collapse back at any point.
function initGridToggle(grid, toggle, itemLabel) {
  if (!toggle || !grid) return;
  var cards = Array.prototype.slice.call(grid.children).filter(function (el) {
    return el.classList.contains('reveal');
  });
  var isMobile = window.matchMedia('(max-width: 640px)').matches;
  var initial = Math.min(isMobile ? MOBILE_CAP : DESKTOP_CAP, cards.length);
  var batch = isMobile ? LOAD_BATCH_MOBILE : LOAD_BATCH_DESKTOP;
  var visible = initial;

  var collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.className = 'grid-collapse';
  collapse.textContent = 'Show fewer';
  toggle.insertAdjacentElement('afterend', collapse);

  function render() {
    cards.forEach(function (card, i) {
      card.style.display = i < visible ? '' : 'none';
      if (i < visible && window.observeReveal) window.observeReveal(card);
    });
    var hidden = cards.length - visible;
    toggle.hidden = hidden <= 0;
    toggle.textContent = 'Load more (' + hidden + ' more ' + itemLabel + ')';
    collapse.hidden = visible <= initial;
  }

  toggle.addEventListener('click', function () {
    visible = Math.min(visible + batch, cards.length);
    render();
  });

  collapse.addEventListener('click', function () {
    visible = initial;
    render();
    grid.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  render();
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
    var title = escapeHtml(p.title || '');
    var medium = escapeHtml(p.medium || '');
    var meta = medium + ' · £' + p.price;
    var subject = encodeURIComponent(p.title || '');
    var stripeLink = p.stripe_link || '';
    var href = stripeLink || '#';
    var slug = p.slug || slugify(p.title || '');
    return (
      '<article class="work reveal">' +
        '<div class="work__frame" data-lightbox data-title="' + title + '" data-meta="' + escapeHtml(meta) + '" data-desc="' + escapeHtml(p.description || '') + '">' +
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

  // Pulls the width×height out of the "medium" text (e.g. "Oil on canvas · 80 × 60 cm")
  // so paintings can be sorted by size without a separate CMS field to keep in sync.
  function sizeOf(p) {
    var m = /([\d.]+)\s*×\s*([\d.]+)/.exec(p.medium || '');
    return m ? parseFloat(m[1]) * parseFloat(m[2]) : 0;
  }

  function sortPaintings(list, mode) {
    var sorted = list.slice();
    if (mode === 'newest') sorted.sort(function (a, b) { return (b.product_id || 0) - (a.product_id || 0); });
    else if (mode === 'oldest') sorted.sort(function (a, b) { return (a.product_id || 0) - (b.product_id || 0); });
    else if (mode === 'price-desc') sorted.sort(function (a, b) { return (b.price || 0) - (a.price || 0); });
    else if (mode === 'price-asc') sorted.sort(function (a, b) { return (a.price || 0) - (b.price || 0); });
    else if (mode === 'size-desc') sorted.sort(function (a, b) { return sizeOf(b) - sizeOf(a); });
    else if (mode === 'size-asc') sorted.sort(function (a, b) { return sizeOf(a) - sizeOf(b); });
    // "curated" (the default): whatever order the paintings are in in the CMS —
    // drag to reorder there and this is what visitors see first.
    return sorted;
  }

  fetch('content/paintings.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var paintings = data.paintings || [];
      var sortSelect = document.getElementById('works-sort-select');
      var categorySelect = document.getElementById('works-category-select');
      var categoryGroup = document.getElementById('works-category-group');

      // Categories are whatever free-text values are currently on the paintings —
      // there's no separate list to keep in sync, so renaming/adding/removing a
      // category in the CMS just changes what shows up here automatically.
      var categories = [];
      paintings.forEach(function (p) {
        if (p.category && categories.indexOf(p.category) === -1) categories.push(p.category);
      });
      if (categorySelect && categories.length > 1) {
        categories.sort();
        categories.forEach(function (c) {
          var opt = document.createElement('option');
          opt.value = c;
          opt.textContent = c;
          categorySelect.appendChild(opt);
        });
        categoryGroup.hidden = false;
      }

      function renderGrid() {
        var mode = sortSelect ? sortSelect.value : 'curated';
        var cat = categorySelect ? categorySelect.value : '';
        var filtered = cat ? paintings.filter(function (p) { return p.category === cat; }) : paintings;
        var ordered = sortPaintings(filtered, mode);
        var html = ordered.map(cardHTML).join('') +
          '<button type="button" class="works-toggle" hidden></button>';
        grid.innerHTML = html;
        grid.removeAttribute('data-loading');

        if (window.wireLazyFade) window.wireLazyFade(grid);

        initLightbox();
        initBuyButtons();
        initGridToggle(grid, grid.querySelector('.works-toggle'), 'paintings');
      }

      renderGrid();
      if (sortSelect) sortSelect.addEventListener('change', renderGrid);
      if (categorySelect) categorySelect.addEventListener('change', renderGrid);
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

  function soldCardHTML(p, i) {
    var title = escapeHtml(p.title || '');
    var medium = escapeHtml(p.medium || '');
    var details = [medium, p.price ? '£' + p.price : ''].filter(Boolean).join(' · ');
    var meta = (details ? details + ' ' : '') + '(Sold)';
    return (
      '<figure class="sold-card reveal">' +
        '<div class="sold-card__frame" data-lightbox data-title="' + title + '" data-meta="' + escapeHtml(meta) + '">' +
          '<img src="' + escapeHtml(p.image) + '" alt="' + title + ' — sold original oil painting by Jonathan Smith" loading="lazy" />' +
          '<span class="sold-card__tag">Sold</span>' +
        '</div>' +
        '<figcaption><b>' + title + '</b>' + (medium ? '<span>' + medium + '</span>' : '') + '</figcaption>' +
      '</figure>'
    );
  }

  fetch('content/paintings-sold.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var sold = data.paintings || [];
      if (!sold.length) { section.hidden = true; return; }
      section.hidden = false;
      var html = sold.map(soldCardHTML).join('') +
        '<button type="button" class="sold-toggle" hidden></button>';
      grid.innerHTML = html;
      if (window.wireLazyFade) window.wireLazyFade(grid);
      initLightbox();
      initGridToggle(grid, grid.querySelector('.sold-toggle'), 'sold works');
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
