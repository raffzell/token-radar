// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, the per-protocol detail view
// and the model panel. No network: every value on screen comes from data.js, and the
// detail view recomputes each row's implied value from the snapshot figures with the
// same formula main.ts used, so the page and board.json visibly agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var root = document.getElementById('main');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'rank', dir: 1, selected: null };

  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return days + ' days';
  }
  function chainLabel(chains) {
    if (!chains || chains.length === 0) return 'one unnamed chain';
    if (chains.length === 1) return chains[0];
    if (chains.length === 2) return chains[0] + ' + 1 more';
    return chains[0] + ' + ' + (chains.length - 1) + ' more';
  }

  // The model, as the page runs it: identical arithmetic to lib/model.ts, so the
  // detail view can check its own number against the one board.json carries.
  function recompute(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_max, Math.max(m.growth_min, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthF = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? DATA.median_age_days : row.age_days;
    var maturity = m.maturity_base + m.maturity_span * Math.sqrt(Math.min(Math.max(age, 0), m.maturity_cap_days) / m.maturity_cap_days);
    var breadth = 1 + m.breadth_per_chain * Math.min((row.chains || []).length, m.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * m.base_rate * growthF * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var val = attrs[key];
        if (val === null || val === undefined || val === false) return;
        if (key === 'class') node.className = val;
        else if (key === 'text') node.textContent = val;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), val);
        else node.setAttribute(key, val);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The watchlist membership each row carries, looked up once for badges and labels.
  var watchSet = new Set(DATA.rows.filter(function (r) { return r.on_watchlist; }).map(function (r) { return r.slug; }));

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return el('header', { class: 'masthead' },
      el('div', { class: 'brand' }, el('span', { class: 'radar-dot', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'masthead-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'Watchlist floor $' + Math.round(DATA.floor_usd / 1e6) + 'M TVL' }),
        el('span', { text: 'Model ' + DATA.model_version })
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('h1', { text: 'Protocols that record no token yet, ranked by what a token could be worth' }),
      el('p', null,
        'The board covers all ', el('strong', { text: DATA.watchlist_size + ' watchlist protocols' }),
        ' — every protocol at or above the floor whose record shows no token — and adds ',
        el('strong', { text: DATA.early_size + ' early protocols' }),
        ' below the floor. Implied value is this entry\u2019s own model, computed from the snapshot alone; it is not a prediction that a token launches, or when.'
      )
    );
  }

  function stats() {
    function stat(value, label, hot) {
      return el('div', { class: hot ? 'stat hot' : 'stat' }, el('b', { text: value }), el('span', { text: label }));
    }
    return el('section', { class: 'stats', 'aria-label': 'Coverage' },
      stat(DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'Watchlist protocols covered', true),
      stat(String(DATA.board_size), 'Pre-token rows ranked'),
      stat(String(DATA.early_size), 'Early rows below the floor'),
      stat(String(DATA.live_size), 'Live-token protocols set aside')
    );
  }

  function controls() {
    var categories = [];
    var seenCat = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (!seenCat[c]) { seenCat[c] = true; categories.push(c); }
    });
    categories.sort();
    var chains = [];
    var seenChain = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { if (!seenChain[c]) { seenChain[c] = true; chains.push(c); } });
    });
    chains.sort();

    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) {
        var attrs = { value: c, text: c };
        if (c === state.category) attrs.selected = 'selected';
        return el('option', attrs);
      })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) {
        var attrs = { value: c, text: c };
        if (c === state.chain) attrs.selected = 'selected';
        return el('option', attrs);
      })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var preBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var liveBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var count = state.tab === 'pre-token' ? visibleRows().length + ' of ' + DATA.rows.length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'control' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'control' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'control' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'control' }, el('label', { text: 'Token status' }), el('div', { class: 'segmented' }, preBtn, liveBtn)),
      el('span', { class: 'shown-count', text: count })
    );
  }

  function sortButton(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' \u2193' : ' \u2191') : '';
    return el('button', {
      type: 'button', class: 'sort-btn',
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        render();
      }
    }, label + arrow);
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'card' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches those filters' }),
        el('p', { text: 'Clear the search or widen the category and chain filters to see the board again.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear all filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var top = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > top) top = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var onWatch = watchSet.has(r.slug);
      var tr = el('tr', {
        'aria-selected': state.selected === r.slug ? 'true' : 'false',
        'data-slug': r.slug,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'cell-main' },
          el('b', { text: r.name }),
          el('span', { class: 'cell-sub', text: (r.category || 'Other') + ' · ' + chainLabel(r.chains) })
        )),
        el('td', { class: 'num', text: money(r.tvl_usd) }),
        el('td', { class: 'num ' + growthCls, text: pct(r.change_7d) }),
        el('td', { class: 'num', text: ageLabel(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', { class: 'value-cell' },
          el('div', { class: 'value-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / top) * 100)) + '%' })),
          el('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: onWatch ? 'badge' : 'badge early', text: onWatch ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'card' }, el('div', { class: 'scroll-x' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols, ranked by implied value. Select any row for its value breakdown and farm plan.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col' }, sortButton('rank', 'Rank')),
          el('th', { scope: 'col' }, sortButton('name', 'Protocol')),
          el('th', { scope: 'col' }, sortButton('tvl', 'TVL')),
          el('th', { scope: 'col' }, sortButton('growth', '7d change')),
          el('th', { scope: 'col' }, sortButton('age', 'Age')),
          el('th', { scope: 'col', text: 'Chains' }),
          el('th', { scope: 'col' }, sortButton('implied', 'Implied value')),
          el('th', { scope: 'col', text: 'Board' })
        )),
        tbody
      )
    ));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'cell-main' },
          el('b', { text: r.name }),
          el('span', { class: 'cell-sub', text: (r.category || 'Other') + ' · ' + chainLabel(r.chains) })
        )),
        el('td', { class: 'num', text: money(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), text: pct(r.change_7d) }),
        el('td', { class: 'num', text: money(r.mcap_usd) }),
        el('td', { class: 'num', text: r.symbol || 'n/a' }),
        el('td', null, el('span', { class: 'badge live', text: 'Trading' }))
      ));
    });
    return el('div', { class: 'card' }, el('div', { class: 'scroll-x' },
      el('table', null,
        el('caption', { text: 'These protocols already trade, so the market has priced them: their market cap is shown as a fact, never modelled, and they stay out of the pre-token ranking.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }),
          el('th', { scope: 'col', text: 'TVL' }),
          el('th', { scope: 'col', text: '7d change' }),
          el('th', { scope: 'col', text: 'Market cap' }),
          el('th', { scope: 'col', text: 'Symbol' }),
          el('th', { scope: 'col', text: 'Token' })
        )),
        tbody
      )
    ));
  }

  function howPanel() {
    var m = DATA.model;
    var formula = 'implied = round( tvl_usd × ' + m.base_rate +
      ' × (1 + clamp(change_7d, ' + m.growth_min + ', ' + m.growth_max + ') / 100 × ' + m.growth_weight + ')' +
      ' × (' + m.maturity_base + ' + ' + m.maturity_span + ' × √(min(age_days, ' + m.maturity_cap_days + ') / ' + m.maturity_cap_days + '))' +
      ' × (1 + ' + m.breadth_per_chain + ' × min(chains, ' + m.breadth_max_chains + ')) )';
    return el('section', { class: 'card how', 'aria-label': 'How implied value is computed' },
      el('h2', { text: 'How it works' }),
      el('p', null,
        'One function scores every row, from the snapshot\u2019s figures alone — TVL, seven-day growth, age, and chain count. ',
        el('strong', { text: 'No protocol name is ever special-cased.' }),
        ' A protocol with no listing date uses the snapshot\u2019s median age of ' + DATA.median_age_days + ' days, and a missing seven-day change counts as zero.'
      ),
      el('div', { class: 'formula', text: formula }),
      el('div', { class: 'factors' },
        el('div', { class: 'factor' },
          el('h3', { text: 'Growth, clamped' }),
          el('p', { text: 'A week\u2019s spike is capped so one outlier cannot swamp the board; a falling protocol is marked down, never below the floor.' })
        ),
        el('div', { class: 'factor' },
          el('h3', { text: 'Maturity, square-root' }),
          el('p', { text: 'The first year of running while its record shows no token counts more than the fourth: age matters most while the launch is still unpriced.' })
        ),
        el('div', { class: 'factor' },
          el('h3', { text: 'Breadth, capped' }),
          el('p', { text: 'A footprint on several chains adds a little; the cap keeps a protocol present on dozens of chains from gaming the rank.' })
        )
      ),
      el('p', { text: 'Wording matters: the board says a protocol \u201Crecords no token\u201D, because a token may exist that the snapshot\u2019s record does not carry. The implied value is this entry\u2019s own claim, not a price and not a promise.' })
    );
  }

  function footer() {
    return el('footer', { class: 'footer' },
      el('span', { class: 'src', text: 'Source: ' + DATA.source }),
      el('span', { text: 'Model ' + DATA.model_version + ' · ' + DATA.board_size + ' rows · snapshot ' + DATA.as_of + ' · rendered offline from data.js' })
    );
  }

  var drawer = el('dialog', { class: 'drawer', id: 'detail', 'aria-labelledby': 'detail-title' });

  // Keep the selected row's highlight in step without rebuilding the page, so
  // opening and closing the drawer never loses the reader's scroll position.
  function syncSelection() {
    document.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.setAttribute('aria-selected', tr.getAttribute('data-slug') === state.selected ? 'true' : 'false');
    });
  }
  drawer.addEventListener('close', function () { state.selected = null; writeHash(); syncSelection(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    syncSelection();
    drawer.textContent = '';
    var b = row.value_breakdown;
    var checked = recompute(row);
    var matches = checked === row.implied_value_usd;
    var inner = el('div', { class: 'drawer-inner' },
      el('div', { class: 'drawer-head' },
        el('div', null,
          el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (watchSet.has(row.slug) ? ' · Watchlist' : ' · Early') }),
          el('h2', { id: 'detail-title', text: row.name }),
          el('p', { class: 'cell-sub', text: (row.category || 'Other') + ' · ' + ((row.chains || []).join(', ') || 'one unnamed chain') })
        ),
        el('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { drawer.close(); } })
      ),
      el('section', { class: 'drawer-section' },
        el('h3', { text: 'Value breakdown' }),
        el('div', { class: 'kv' },
          el('div', null, el('span', { text: 'TVL' }), el('b', { text: money(row.tvl_usd) })),
          el('div', null, el('span', { text: 'Seven-day change (clamped)' }), el('b', { text: pct(b.growth_pct) })),
          el('div', null, el('span', { text: 'Growth factor' }), el('b', { text: '×' + b.growth_factor })),
          el('div', null, el('span', { text: 'Age used' }), el('b', { text: ageLabel(b.age_days_used) + (b.age_known ? '' : ' (median, listing date unknown)') })),
          el('div', null, el('span', { text: 'Maturity factor' }), el('b', { text: '×' + b.maturity_factor })),
          el('div', null, el('span', { text: 'Chain breadth factor' }), el('b', { text: '×' + b.breadth_factor })),
          el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: money(row.implied_value_usd) }))
        ),
        el('p', { class: 'check-note' },
          matches ? el('b', { text: 'Checked: ' }) : 'Note: ',
          'this page recomputes the row as ' + money(checked) + (matches ? ', the same number board.json carries.' : ', which differs from board.json — the data would be stale.')
        ),
        el('p', { class: 'check-note', text: 'Token status: records no token — the snapshot carries no market cap, no CoinGecko id and no symbol for this protocol. An estimate, not a price.' })
      ),
      el('section', { class: 'drawer-section' },
        el('h3', { text: 'Farm plan' }),
        el('ol', { class: 'plan' }, row.farm_steps.map(function (s) {
          return el('li', null,
            el('p', { text: s.text }),
            el('div', { class: 'cost-time' },
              el('span', { class: 'chip', text: 'Cost: ' + s.cost }),
              el('span', { class: 'chip', text: 'Time: ' + s.time })
            )
          );
        }))
      )
    );
    drawer.appendChild(inner);
    if (typeof drawer.showModal === 'function') {
      if (!drawer.open) drawer.showModal();
    } else {
      drawer.setAttribute('open', '');
    }
  }

  function render() {
    root.textContent = '';
    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(masthead());
    wrap.appendChild(hero());
    wrap.appendChild(stats());
    wrap.appendChild(controls());
    wrap.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') wrap.appendChild(howPanel());
    wrap.appendChild(footer());
    root.appendChild(wrap);
    root.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) root.appendChild(drawer);
    if (state.selected && !drawer.open) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.open) drawer.close();
  });
})();
