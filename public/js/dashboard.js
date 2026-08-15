'use strict';
(function () {
  // ---------- mobile sidebar toggle + overlay ----------
  const menuBtn = document.getElementById('menuToggle');
  const overlay = document.getElementById('dashOverlay');
  const nav = document.querySelector('.dash-nav');
  function openNav() {
    if (nav) nav.classList.add('open');
    if (overlay) overlay.classList.add('show');
  }
  function closeNav() {
    if (nav) nav.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }
  if (menuBtn) menuBtn.addEventListener('click', function () {
    if (nav && nav.classList.contains('open')) {
      closeNav();
    } else {
      openNav();
    }
  });
  if (overlay) overlay.addEventListener('click', closeNav);

  // Open sidebar by default on desktop, hidden on mobile
  if (nav && window.innerWidth > 980) {
    nav.classList.add('open');
    if (overlay) overlay.classList.remove('show');
  }

  // ---------- live market ticker ----------
  const mtItems = Array.prototype.slice.call(document.querySelectorAll('.mt-item'));
  const mtState = {};
  mtItems.forEach(function (el) {
    const sym = el.querySelector('.mt-sym').textContent.trim();
    const pxText = el.querySelector('.mt-px').textContent.replace(/[^0-9.\-]/g, '');
    const chgPctText = el.querySelector('.mt-chg').textContent.replace(/[^0-9.\-]/g, '');
    const price = parseFloat(pxText) || 0;
    const pct = parseFloat(chgPctText) || 0;
    const open = price / (1 + pct / 100);
    mtState[sym] = { el, price: price, open: open, pct: pct };
  });
  function updateTicker() {
    Object.keys(mtState).forEach(function (sym) {
      const s = mtState[sym];
      const drift = (Math.random() - 0.5) * 0.012; // ±0.6% drift
      s.price = Math.max(0.01, s.price * (1 + drift));
      const change = s.price - s.open;
      const changePct = (change / s.open) * 100;
      const up = change >= 0;
      const pxEl = s.el.querySelector('.mt-px');
      const chgEl = s.el.querySelector('.mt-chg');
      pxEl.textContent = '$' + s.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      chgEl.textContent = (up ? '▲ ' : '▼ ') + (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
      chgEl.classList.remove('pos', 'neg', 'flash-up', 'flash-down');
      chgEl.classList.add(up ? 'pos' : 'neg');
      chgEl.classList.add(up ? 'flash-up' : 'flash-down');
    });
  }
  if (mtItems.length) setInterval(updateTicker, 3000);

  // ---------- generic tabs ----------
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    group.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-tab');
        const panel = group.parentElement.querySelector('[data-panel="' + id + '"]');
        if (!panel) return;
        group.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const panels = group.parentElement.querySelectorAll('.tab-panel');
        panels.forEach(p => p.classList.remove('active'));
        panel.classList.add('active');
      });
    });
  });

  // ---------- sidebar scrollspy + smooth scroll ----------
  const navLinks = Array.prototype.slice.call(document.querySelectorAll('.dash-nav a'));
  let lastNavClick = 0;
  // Build the section list, skipping non-fragment hrefs (e.g. `/profile`) which are
  // not valid CSS selectors. Without the try/catch the `.map` above throws and
  // aborts the whole script — breaking the chart, watchlist ticks and sidebar
  // highlighting (clicking a section never updated the active link).
  const sections = navLinks
    .map(function (a) {
      const h = a.getAttribute('href');
      if (!h || h.charAt(0) !== '#') return null;
      try { return document.querySelector(h); } catch (e) { return null; }
    })
    .filter(Boolean);
  navLinks.forEach(function (a) {
    a.addEventListener('click', function () {
      // close mobile nav + overlay when a link is clicked
      if (nav) nav.classList.remove('open');
      if (overlay) overlay.classList.remove('show');
      let target = null;
      try { target = document.querySelector(a.getAttribute('href')); } catch (e) { target = null; }
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Immediately mark the clicked link active (handles non-intersecting sections)
      navLinks.forEach(l => l.classList.remove('active'));
      a.classList.add('active');
      lastNavClick = Date.now();
    });
  });
  // Robust scrollspy: pick the section closest to the top of the viewport.
  function updateActive() {
    if (!sections.length) return;
    // Honor the click-driven selection for a moment so smooth scrolling doesn't
    // re-stamp a different (e.g. still-at-top) section as active.
    if (Date.now() - lastNavClick < 700) return;
    let best = 0;
    let bestDist = Infinity;
    const navRectTop = 120; // offset to account for sticky header + ticker
    sections.forEach(function (s, i) {
      const rect = s.getBoundingClientRect();
      const dist = Math.abs(rect.top - navRectTop);
      if (rect.top < window.innerHeight * 0.6 && dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    navLinks.forEach(l => l.classList.remove('active'));
    if (navLinks[best]) navLinks[best].classList.add('active');
  }
  if ('IntersectionObserver' in window && sections.length) {
    // Use IntersectionObserver for broad detection, supplement with scroll listener
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) updateActive();
      });
    }, { rootMargin: '-20% 0px -20% 0px', threshold: 0 });
    sections.forEach(s => obs.observe(s));
  }
  // Fallback: update active state on scroll (debounced)
  let scrollTick = false;
  window.addEventListener('scroll', function () {
    if (!scrollTick) {
      scrollTick = true;
      requestAnimationFrame(function () {
        updateActive();
        scrollTick = false;
      });
    }
  }, { passive: true });

  // ---------- quick symbol picker for trade ticket ----------
  document.querySelectorAll('.qsym').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const sym = btn.getAttribute('data-sym');
      const input = document.getElementById('tkSymbol');
      if (input && sym) input.value = sym;
    });
  });

  // ---------- trade ticket prefill from watchlists / instruments ----------
  // If a trade ticket (#tkSymbol) exists on the page (e.g. the trading page),
  // fill it and scroll into view. Otherwise navigate to /trading with the symbol
  // as a query param so the trade ticket is pre-filled on arrival.
  (function prefillTradeTicketFromUrl() {
    var input = document.getElementById('tkSymbol');
    if (!input) return;
    var params = new URLSearchParams(window.location.search);
    var sym = params.get('symbol');
    if (sym) {
      input.value = sym.toUpperCase();
      var t = document.getElementById('trading');
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      input.focus();
    }
  })();

  document.querySelectorAll('.trade-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const sym = btn.getAttribute('data-symbol');
      if (!sym) return;
      const input = document.getElementById('tkSymbol');
      if (input) {
        input.value = sym;
        const t = document.getElementById('trading');
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        input.focus();
      } else {
        window.location.href = '/trading?symbol=' + encodeURIComponent(sym);
      }
    });
  });

  // ---------- quick-action buttons: toggle in-dashboard money-action cards ----------
  document.querySelectorAll('[data-panel]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = btn.getAttribute('data-panel');
      if (p === 'trade') {
        var t = document.getElementById('trading');
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      var card = document.getElementById('action-' + p);
      if (card) {
        var isOpen = card.classList.contains('open');
        document.querySelectorAll('.action-card').forEach(function (c) { c.classList.remove('open'); });
        if (!isOpen) card.classList.add('open');
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ---------- sidebar nav: open money-action card from hash ----------
  (function openPanelFromHash() {
    var hash = window.location.hash.substring(1);
    var panelMap = { transfer: 'transfer', deposit: 'deposit', paybills: 'paybills', movemoney: 'movemoney', externaltransfer: 'externaltransfer' };
    var panel = panelMap[hash];
    var openPanel = (document.body && document.body.dataset && document.body.dataset.openPanel) || '';
    if (panel && openPanel === panel) {
      var card = document.getElementById('action-' + panel);
      if (card) { card.classList.add('open'); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
  })();

  // ---------- live watchlist quotes ----------
  const live = document.getElementById('wlLive');
  const rows = {};
  document.querySelectorAll('.wl-table tbody tr[data-sym]').forEach(function (tr) {
    const sym = tr.getAttribute('data-sym');
    const priceEl = tr.querySelector('.lv-price');
    const chgEl = tr.querySelector('.lv-chg');
    const pctEl = tr.querySelector('.lv-pct');
    const price = parseFloat(priceEl.textContent.replace(/[^0-9.\-]/g, '')) || 0;
    const pct = parseFloat(pctEl.textContent.replace(/[^0-9.\-]/g, '')) || 0;
    rows[sym] = { tr, priceEl, chgEl, pctEl, price: price, open: price / (1 + pct / 100) };
  });
  function tick() {
    if (!live || !live.checked) return;
    Object.keys(rows).forEach(function (sym) {
      const r = rows[sym];
      const drift = (Math.random() - 0.5) * 0.004;
      const newPrice = r.price * (1 + drift);
      const change = newPrice - r.open;
      const changePct = (change / r.open) * 100;
      const up = newPrice >= r.price;
      r.price = newPrice;
      r.priceEl.textContent = '$' + newPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      r.chgEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2);
      r.pctEl.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
      r.pctEl.classList.toggle('pos', changePct >= 0);
      r.pctEl.classList.toggle('neg', changePct < 0);
      const flash = up ? 'flash-up' : 'flash-down';
      r.priceEl.classList.remove('flash-up', 'flash-down');
      void r.priceEl.offsetWidth;
      r.priceEl.classList.add(flash);
    });
  }
  if (Object.keys(rows).length) setInterval(tick, 1500);

  // ---------- advanced candlestick chart ----------
  const D = window.__DASH__ || {};
  const candles = D.candles || [];
  const chartEl = document.getElementById('candleChart');
  const TF = { 'tf-1d': 26, 'tf-1w': 10, 'tf-1m': 22, 'tf-3m': 65, 'tf-6m': 120, 'tf-1y': 120 };
  const state = { tf: 'tf-1m', inds: { ma20: true, ma50: true, vwap: false, bb: false }, cmp: '' };

  function sma(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (i < n - 1) { out.push(null); continue; }
      let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j];
      out.push(s / n);
    }
    return out;
  }
  function stddev(arr, n, means) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (i < n - 1 || means[i] == null) { out.push(null); continue; }
      let s = 0; for (let j = i - n + 1; j <= i; j++) s += Math.pow(arr[j] - means[i], 2);
      out.push(Math.sqrt(s / n));
    }
    return out;
  }

  function renderChart() {
    if (!chartEl || !candles.length) return;
    const n = TF[state.tf] || candles.length;
    const data = candles.slice(-n);
    const W = 900, H = 320, padL = 8, padR = 56, padT = 10, padB = 22;
    const min = Math.min.apply(null, data.map(d => d.l));
    const max = Math.max.apply(null, data.map(d => d.h));
    const range = (max - min) || 1;
    const x = i => padL + (i + 0.5) * (W - padL - padR) / data.length;
    const y = v => padT + (1 - (v - min) / range) * (H - padT - padB);
    const cw = Math.max(2, (W - padL - padR) / data.length * 0.62);

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="candle-svg" width="100%">';
    // gridlines
    for (let g = 0; g <= 4; g++) {
      const gy = padT + g * (H - padT - padB) / 4;
      svg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#eee" stroke-width="1"/>';
      const val = max - (g / 4) * range;
      svg += '<text x="' + (W - padR + 4) + '" y="' + (gy + 3) + '" font-size="9" fill="#888">' + val.toFixed(0) + '</text>';
    }
    // candles
    data.forEach(function (d, i) {
      const cx = x(i);
      const up = d.c >= d.o;
      const col = up ? '#1e6f1d' : '#981077';
      svg += '<line x1="' + cx + '" y1="' + y(d.h) + '" x2="' + cx + '" y2="' + y(d.l) + '" stroke="' + col + '" stroke-width="1"/>';
      const yo = y(d.o), yc = y(d.c);
      const top = Math.min(yo, yc), hgt = Math.max(1, Math.abs(yo - yc));
      svg += '<rect x="' + (cx - cw / 2) + '" y="' + top + '" width="' + cw + '" height="' + hgt + '" fill="' + col + '"/>';
    });
    // indicators
    const closes = data.map(d => d.c);
    if (state.inds.ma20) {
      const m = sma(closes, 20);
      svg += poly(closes, m, x, y, '#0a655a', 1.5, data.length);
    }
    if (state.inds.ma50) {
      const m = sma(closes, 50);
      svg += poly(closes, m, x, y, '#c47d00', 1.5, data.length);
    }
    if (state.inds.vwap) {
      let cumPV = 0, cumV = 0; const vwap = closes.map((c, i) => {
        const tp = (data[i].h + data[i].l + c) / 3;
        cumPV += tp * data[i].v; cumV += data[i].v;
        return cumPV / (cumV || 1);
      });
      svg += poly(closes, vwap, x, y, '#7a3fb0', 1.2, data.length);
    }
    if (state.inds.bb) {
      const m = sma(closes, 20); const sd = stddev(closes, 20, m);
      const upper = m.map((v, i) => v == null ? null : v + 2 * sd[i]);
      const lower = m.map((v, i) => v == null ? null : v - 2 * sd[i]);
      svg += poly(closes, upper, x, y, '#058070', 1, data.length, true);
      svg += poly(closes, lower, x, y, '#058070', 1, data.length, true);
    }
    if (state.cmp) {
      // faint comparison line (deterministic shift of close)
      const cmp = closes.map(c => c * (state.cmp === 'SPY' ? 0.6 : 0.7));
      svg += poly(closes, cmp, x, y, '#bbb', 1, data.length);
    }
    svg += '</svg>';
    chartEl.innerHTML = svg;
  }
  function poly(closes, vals, x, y, color, w, len, dashed) {
    let pts = [];
    for (let i = 0; i < len; i++) {
      if (vals[i] == null) continue;
      pts.push(x(i).toFixed(1) + ',' + y(vals[i]).toFixed(1));
    }
    if (!pts.length) return '';
    return '<polyline fill="none" stroke="' + color + '" stroke-width="' + w + '"' + (dashed ? ' stroke-dasharray="3 3"' : '') + ' points="' + pts.join(' ') + '"/>';
  }

  // chart timeframe buttons
  document.querySelectorAll('.chart-toolbar [data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.tf = b.getAttribute('data-tab');
      b.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      b.classList.add('active');
      renderChart();
    });
  });
  // indicator toggles
  document.querySelectorAll('.chart-toggles .ind').forEach(function (b) {
    b.addEventListener('click', function () {
      const ind = b.getAttribute('data-ind');
      state.inds[ind] = !state.inds[ind];
      b.classList.toggle('on', state.inds[ind]);
      renderChart();
    });
  });
  const cmpSel = document.getElementById('cmpSel');
  if (cmpSel) cmpSel.addEventListener('change', function () { state.cmp = cmpSel.value; renderChart(); });

  // ---------- scroll-reveal animation ----------
  const revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && revealEls.length) {
    const ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in-view'); ro.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
    revealEls.forEach(function (el) { ro.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in-view'); });
  }
  // safety net: never leave content hidden
  setTimeout(function () { revealEls.forEach(function (el) { el.classList.add('in-view'); }); }, 1600);

  // ---------- custom dropdown enhancement ----------
  (function enhanceSelects() {
    var selects = document.querySelectorAll('select');
    selects.forEach(function (sel) {
      if (sel.parentNode.classList.contains('cs-wrap')) return;

      var wrap = document.createElement('div');
      wrap.className = 'cs-wrap';
      sel.classList.add('cs-real');

      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'cs-trigger';
      trigger.setAttribute('tabindex', '0');

      var menu = document.createElement('div');
      menu.className = 'cs-menu';

      Array.from(sel.options).forEach(function (opt) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'cs-item';
        item.textContent = opt.textContent;
        item.dataset.value = opt.value;
        if (opt.selected) item.classList.add('selected');
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          sel.value = opt.value;
          trigger.textContent = opt.textContent;
          var items = menu.querySelectorAll('.cs-item');
          items.forEach(function (i) { i.classList.remove('selected'); });
          item.classList.add('selected');
          menu.classList.remove('open');
          wrap.classList.remove('open');
        });
        menu.appendChild(item);
      });

      var current = sel.options[sel.selectedIndex];
      trigger.textContent = current ? current.textContent : '';

      wrap.appendChild(sel);
      wrap.appendChild(trigger);
      wrap.appendChild(menu);
      sel.parentNode.insertBefore(wrap, sel);

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = wrap.classList.toggle('open');
        menu.classList.toggle('open', isOpen);
      });
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          wrap.classList.add('open');
          menu.classList.add('open');
        }
        if (e.key === 'Escape') {
          wrap.classList.remove('open');
          menu.classList.remove('open');
          trigger.focus();
        }
      });
      document.addEventListener('click', function (e) {
        if (!wrap.contains(e.target)) {
          wrap.classList.remove('open');
          menu.classList.remove('open');
        }
      });
    });
  })();

  renderChart();
})();
