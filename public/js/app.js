/* app.js — Book Notes interactions
   Custom cursor · Nav scroll · Stats counter · Reveal · Tilt · Toast
*/

(function () {
  'use strict';

  /* ── Custom cursor ─────────────────────── */
  const cursor     = document.getElementById('cursor');
  const cursorRing = document.getElementById('cursorRing');

  if (cursor && cursorRing && window.matchMedia('(pointer: fine)').matches) {
    let mx = -100, my = -100;
    let rx = -100, ry = -100;

    document.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      cursor.style.left = mx + 'px';
      cursor.style.top  = my + 'px';
    });

    // Ring follows with lag
    (function animateRing() {
      rx += (mx - rx) * .14;
      ry += (my - ry) * .14;
      cursorRing.style.left = rx + 'px';
      cursorRing.style.top  = ry + 'px';
      requestAnimationFrame(animateRing);
    })();

    // Hover states
    document.querySelectorAll('a, button, .pill, .ol-card, .card, input, textarea, select, .stat').forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        cursor.classList.add('hovered');
        cursorRing.classList.add('hovered');
      });
      el.addEventListener('mouseleave', function () {
        cursor.classList.remove('hovered');
        cursorRing.classList.remove('hovered');
      });
    });

    document.addEventListener('mousedown', function () { cursor.classList.add('clicked'); });
    document.addEventListener('mouseup',   function () { cursor.classList.remove('clicked'); });
  }

  /* ── Nav scroll behaviour ───────────────── */
  var nav = document.getElementById('mainNav');
  if (nav) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 20) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  /* ── Animated counter for stats numbers ── */
  function animateCount(el, target) {
    var start    = 0;
    var duration = 900;
    var startTime = null;
    var isDecimal = String(target).includes('.');
    var num = parseFloat(target);
    if (isNaN(num)) return;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      // ease-out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = start + (num - start) * eased;
      el.textContent = isDecimal
        ? current.toFixed(1)
        : Math.round(current).toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = isDecimal ? num.toFixed(1) : num.toLocaleString();
    }
    requestAnimationFrame(step);
  }

  // Observe stat numbers
  var statNums = document.querySelectorAll('.stat-n, .overview-n');
  if (statNums.length && 'IntersectionObserver' in window) {
    var countObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el  = entry.target;
          var raw = el.textContent.trim().replace(/,/g, '');
          if (raw !== '—') animateCount(el, raw);
          countObs.unobserve(el);
        }
      });
    }, { threshold: .5 });
    statNums.forEach(function (el) { countObs.observe(el); });
  }

  /* ── Scroll reveal ──────────────────────── */
  var reveals = document.querySelectorAll('.reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObs.unobserve(entry.target);
        }
      });
    }, { threshold: .1, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { revealObs.observe(el); });
  }

  /* ── Card 3-D tilt ──────────────────────── */
  document.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('mousemove', function (e) {
      var rect   = card.getBoundingClientRect();
      var cx     = rect.left + rect.width  / 2;
      var cy     = rect.top  + rect.height / 2;
      var dx     = (e.clientX - cx) / (rect.width  / 2);
      var dy     = (e.clientY - cy) / (rect.height / 2);
      var rotX   = -dy * 6;
      var rotY   =  dx * 6;
      card.style.transform = 'translateY(-6px) rotateX(' + rotX + 'deg) rotateY(' + rotY + 'deg)';
      card.style.transition = 'box-shadow .2s, border-color .2s';
    });
    card.addEventListener('mouseleave', function () {
      card.style.transform  = '';
      card.style.transition = '';
    });
  });

  /* ── Toast notifications ────────────────── */
  window.showToast = function (msg, isErr) {
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' toast--err' : '');
    t.innerHTML = '<div class="toast-dot"></div><span>' + msg + '</span>';
    container.appendChild(t);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { t.classList.add('show'); });
    });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 400);
    }, 3000);
  };

  // Fire toast based on URL param
  var params = new URLSearchParams(window.location.search);
  if (params.get('added'))   showToast('Book added to your library');
  if (params.get('updated')) showToast('Changes saved');
  if (params.get('deleted')) showToast('Book removed');

  /* ── Delete confirm enhancement ────────── */
  document.querySelectorAll('.delete-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!confirm('Remove this book permanently?')) e.preventDefault();
    });
  });

  /* ── Search clear on Escape ─────────────── */
  var searchInput = document.getElementById('live-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        searchInput.blur();
      }
    });
  }

  /* ── Live search with highlight ─────────── */
  if (searchInput) {
    var grid = document.getElementById('book-grid');
    searchInput.addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      if (!grid) return;
      grid.querySelectorAll('.card').forEach(function (card) {
        var match = !q
          || card.dataset.title.includes(q)
          || card.dataset.author.includes(q);
        card.style.display   = match ? '' : 'none';
        card.style.opacity   = match ? '' : '0';
        card.style.transform = match ? '' : 'scale(.95)';
      });
    });
  }

  /* ── Smooth input focus ring on forms ───── */
  document.querySelectorAll('.input').forEach(function (input) {
    input.addEventListener('focus', function () {
      this.parentElement.classList.add('field--focused');
    });
    input.addEventListener('blur', function () {
      this.parentElement.classList.remove('field--focused');
    });
  });

})();