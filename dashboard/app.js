// Token Radar's page (radar-2). It reads window.RADAR, written beside dashboard/ by
// main.ts, and renders the ranked board, a filterable table, a per-protocol detail
// drawer, and the model's own sandbox. No network: every byte it shows is in data.js.
//
// The sandbox recomputes a row from the snapshot figures with the same arithmetic
// lib/model.ts uses, so the page's code and the board's data are visibly the same
// model. Changing a sandbox slider re-ranks the page only; the submitted board
// always uses the model's default constants.

(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA) {
    // No data.js beside dashboard/: a designed error, not a blank page. The
    // page reads window.RADAR from data.js, which main.ts writes from the
    // sealed snapshot.
    app.setAttribute('aria-busy', 'false');
    var err = document.createElement('div');
    err.className = 'empty';
    var errH = document.createElement('h3');
    errH.textContent = 'No data to show';
    var errP = document.createElement('p');
    errP.textContent = 'This page reads its data from data.js beside dashboard/. Generate it with main.ts on the sealed snapshot, then reload.';
    err.appendChild(errH);
    err.appendChild(errP);
    app.appendChild(err);
    return;
  }
  app.setAttribute('aria-busy', 'false');

  var PAGE_SIZE = 25;
  var STAR_KEY = 'token-radar-starred';
  var state = {
    q: '', chain: 'all', category: 'all', tab: 'all',
    sort: 'rank', dir: 1, page: 1, selected: null, sandbox: false,
  };
  var model = {
    tvl_exponent: DATA.model.tvl_exponent,
    growth_weight: DATA.model.growth_weight,
    growth_floor: DATA.model.growth_floor,
    growth_cap: DATA.model.growth_cap,
    maturity_floor: DATA.model.maturity_floor,
    maturity_range: DATA.model.maturity_range,
    maturity_days: DATA.model.maturity_days,
    unknown_age_days: DATA.model.unknown_age_days,
    chain_step: DATA.model.chain_step,
    chain_max_steps: DATA.model.chain_max_steps,
  };

  /* ---------- theme ---------- */

  // Dark is the default. The toggle in the top bar flips data-theme on <html>
  // and remembers the choice; the meta theme-color follows so the browser
  // chrome matches the page in either theme.
  var themeBtn = document.getElementById('theme-toggle');
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeMeta) themeMeta.setAttribute('content', theme === 'light' ? '#f4f7f8' : '#0c1a24');
    if (themeBtn) {
      themeBtn.textContent = theme === 'light' ? '☾' : '☀';
      themeBtn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    }
    try { localStorage.setItem('token-radar-theme', theme); } catch (e) { /* private mode */ }
  }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('token-radar-theme'); } catch (e) { /* private mode */ }
  applyTheme(savedTheme === 'light' ? 'light' : 'dark');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
    });
  }

  /* ---------- formatting ---------- */

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // A protocol's chains as one short line: the first three, then how many more.
  // The full list stays in the detail drawer; the table stays scannable.
  function chainLabel(chains) {
    var c = chains || [];
    if (c.length <= 3) return c.join(', ');
    return c.slice(0, 3).join(', ') + ' +' + (c.length - 3) + ' more';
  }

  /* ---------- the model, in the page ---------- */

  // Same arithmetic as lib/model.ts impliedValue, so a sandbox change re-ranks
  // the page exactly the way the model would.
  function impliedOf(row, m) {
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chains = Math.max((row.chains || []).length, 1);
    var chainMult = 1 + m.chain_step * Math.min(chains - 1, m.chain_max_steps);
    var base = row.category_multiple * Math.pow(Math.max(row.tvl_usd, 1), m.tvl_exponent);
    return { implied: Math.max(1, Math.round(base * growthMult * maturity * chainMult)), growthMult: growthMult, maturity: maturity, chainMult: chainMult };
  }

  function scoredRows() {
    if (!state.sandbox) return DATA.rows.slice();
    var rows = DATA.rows.map(function (r) {
      var v = impliedOf(r, model);
      var copy = {};
      for (var k in r) copy[k] = r[k];
      copy.implied_value_usd = v.implied;
      copy.growth_multiplier = Math.round(v.growthMult * 1e4) / 1e4;
      copy.maturity_multiplier = Math.round(v.maturity * 1e4) / 1e4;
      copy.chain_multiplier = Math.round(v.chainMult * 1e4) / 1e4;
      return copy;
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  /* ---------- starred ---------- */

  function starred() {
    try { return JSON.parse(localStorage.getItem(STAR_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function isStarred(slug) { return starred().indexOf(slug) >= 0; }
  function toggleStar(slug) {
    var list = starred();
    var at = list.indexOf(slug);
    if (at >= 0) list.splice(at, 1); else list.push(slug);
    try { localStorage.setItem(STAR_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
    renderCounts();
    if (state.tab === 'starred') renderTable();
    if (state.selected) openDrawer(state.selected, true);
  }

  /* ---------- filtering + sorting ---------- */

  // The watchlist is the floor: a row is on it when its slug is one of the 40 the
  // snapshot names. The board carries the flag in data.js via row.watchlist.
  function isWatch(r) { return !!r.watchlist; }

  function visibleRows() {
    var rows = scoredRows();
    if (state.tab === 'watchlist') rows = rows.filter(isWatch);
    else if (state.tab === 'early') rows = rows.filter(function (r) { return !isWatch(r); });
    else if (state.tab === 'starred') rows = rows.filter(function (r) { return isStarred(r.slug); });
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.toLowerCase().indexOf(q) >= 0; });
    }
    if (state.chain !== 'all') rows = rows.filter(function (r) { return (r.chains || []).indexOf(state.chain) >= 0; });
    if (state.category !== 'all') rows = rows.filter(function (r) { return (r.category || 'Uncategorized') === state.category; });
    var key = state.sort;
    var dir = state.dir;
    var val = function (r) {
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'implied') return r.implied_value_usd;
      return r.rank;
    };
    rows.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return rows;
  }

  /* ---------- small DOM helper ---------- */

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  /* ---------- static sections ---------- */

  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // The "Top implied value" stat follows the ranking on screen — the submitted
  // one by default, the sandbox's when a slider moves.
  function updateTopStat(rows) {
    var value = document.getElementById('stat-top-value');
    var note = document.getElementById('stat-top-note');
    if (!value || !note) return;
    var top = rows[0];
    value.textContent = top ? fmtUsd(top.implied_value_usd) : 'n/a';
    note.textContent = top ? top.name + ', rank 1' : '';
  }

  // The Top 10 chart follows the ranking on screen, same as the stat above.
  function updateChart(rows) {
    var body = document.getElementById('chart-body');
    if (!body) return;
    body.innerHTML = '';
    var top10 = rows.slice(0, 10);
    var max = top10.length ? top10[0].implied_value_usd : 1;
    top10.forEach(function (r) {
      var pct = Math.max(2, Math.round((r.implied_value_usd / max) * 100));
      body.appendChild(el('div', { class: 'chart-row' },
        el('span', { class: 'chart-rank', text: String(r.rank) }),
        el('span', { class: 'chart-name', text: r.name }),
        el('span', { class: 'chart-bar' }, el('span', { class: 'chart-fill', style: 'width:' + pct + '%' })),
        el('span', { class: 'chart-value', text: fmtUsd(r.implied_value_usd) })));
    });
  }

  function renderStatic() {
    document.getElementById('top-sub').textContent =
      DATA.board_size + ' pre-token protocols ranked, snapshot ' + DATA.as_of + ', sealed DefiLlama data, no live feed';
    document.getElementById('snap-date').textContent = DATA.as_of;
    document.getElementById('side-asof').textContent = 'As of ' + DATA.as_of + ', floor $' + (DATA.floor_usd / 1e6) + 'M TVL';

    var changes = DATA.rows.map(function (r) { return r.change_7d; }).filter(function (n) { return n !== null && isFinite(n); });
    var med = median(changes);
    var totalTvl = DATA.rows.reduce(function (sum, r) { return sum + r.tvl_usd; }, 0);

    var strip = el('section', { class: 'stats', 'aria-label': 'Board at a glance' },
      el('div', { class: 'stat' },
        el('p', { class: 'stat-label', text: 'Watchlist protocols' }),
        el('p', { class: 'stat-value num', text: String(DATA.watchlist_size) }),
        el('p', { class: 'stat-note', text: 'the floor — every one is ranked' })),
      el('div', { class: 'stat' },
        el('p', { class: 'stat-label', text: 'Board rows' }),
        el('p', { class: 'stat-value num', text: String(DATA.board_size) }),
        el('p', { class: 'stat-note', text: DATA.early_size + ' early finds below the floor' })),
      el('div', { class: 'stat' },
        el('p', { class: 'stat-label', text: 'Top implied value' }),
        el('p', { class: 'stat-value num', id: 'stat-top-value' }),
        el('p', { class: 'stat-note', id: 'stat-top-note' })),
      el('div', { class: 'stat' },
        el('p', { class: 'stat-label', text: 'Median 7-day change' }),
        el('p', { class: 'stat-value num ' + (med !== null && med >= 0 ? 'up' : 'down'), text: med === null ? 'n/a' : fmtPct(med) }),
        el('p', { class: 'stat-note', text: 'TVL tracked: ' + fmtUsd(totalTvl) })));
    app.appendChild(strip);
    updateTopStat(scoredRows());

    // Hero: the top 10 by implied value, as bars with oversized rank numerals.
    var chart = el('section', { class: 'panel', id: 'chart', 'aria-label': 'Top 10 by implied value' });
    chart.appendChild(el('div', { class: 'panel-head' },
      el('h2', { text: 'Top 10 by implied value' }),
      el('p', { text: 'What a token could be worth if the protocol’s record stayed as it is.' })));
    var chartBody = el('div', { class: 'chart', id: 'chart-body' });
    chart.appendChild(chartBody);
    app.appendChild(chart);
    updateChart(scoredRows());

    // Model note + biggest 7-day movers, side by side.
    var split = el('div', { class: 'split' });
    var modelCard = el('section', { class: 'panel', id: 'model', 'aria-label': 'The model' });
    modelCard.appendChild(el('div', { class: 'panel-head' }, el('h2', { text: 'How the value is worked out' })));
    var note = el('div', { class: 'model-note' },
      el('p', { html: 'Implied value = category multiple × TVL<sup>0.92</sup> × growth × maturity × chains. Size has diminishing returns, so a protocol ten times bigger is not automatically ten times more valuable.' }),
      el('p', { html: 'Growth is the 7-day TVL change, clamped to −60%…+150% and weighted 0.6. Maturity rises with how long the protocol has run with no token, up to four years. Each extra chain adds 3%, up to five.' }),
      el('p', { html: 'Lending and exchange protocols carry a 0.35 multiple. Wrapped, staked and bridged products are never ranked — the value sits with the asset they wrap, not with the venue — except the three the competition’s own watchlist names (b14g, Reti Pooling, Saturn), which the board must cover.' }),
      el('p', { html: 'The sandbox below re-ranks the page live. The submitted board uses the defaults above.' }));
    modelCard.appendChild(note);
    split.appendChild(modelCard);

    var movers = DATA.rows.filter(function (r) { return r.change_7d !== null && r.change_7d > 0; })
      .sort(function (a, b) { return b.change_7d - a.change_7d; }).slice(0, 5);
    var moverCard = el('section', { class: 'panel', 'aria-label': 'Biggest 7-day movers' });
    moverCard.appendChild(el('div', { class: 'panel-head' }, el('h2', { text: 'Biggest 7-day movers' }), el('p', { text: 'Raw 7-day TVL change; the model clamps it to +150%.' })));
    var list = el('ul', { class: 'movers' });
    movers.forEach(function (r) {
      list.appendChild(el('li', {},
        el('span', { class: 'm-name', text: '#' + r.rank + ' ' + r.name }),
        el('span', { class: 'num up', text: fmtPct(r.change_7d) })));
    });
    moverCard.appendChild(list);
    split.appendChild(moverCard);
    app.appendChild(split);
  }

  /* ---------- table ---------- */

  var tableHost, pagerHost;
  var chains = [];
  var categories = [];
  (function () {
    var cset = {}, kset = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { cset[c] = true; });
      kset[r.category || 'Uncategorized'] = true;
    });
    chains = Object.keys(cset).sort();
    categories = Object.keys(kset).sort();
  })();

  function renderTableShell() {
    var card = el('section', { class: 'panel', id: 'table-card', 'aria-label': 'Ranked board' });
    card.appendChild(el('div', { class: 'panel-head' },
      el('h2', { text: 'The board' }),
      el('p', { text: 'Sortable, filterable. Select a row for its detail and farm plan.' })));
    var tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Board lists' });
    [['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Early finds'], ['live', 'Live tokens'], ['starred', 'Starred']].forEach(function (t) {
      tabs.appendChild(el('button', {
        class: 'tab' + (state.tab === t[0] ? ' is-active' : ''), type: 'button', role: 'tab',
        'aria-selected': state.tab === t[0] ? 'true' : 'false', 'aria-controls': 'table-card',
        onclick: function () { state.tab = t[0]; state.page = 1; syncHash(); renderTable(); },
      }, t[1]));
    });
    card.appendChild(tabs);
    var filters = el('div', { class: 'filters' });
    var chainSel = el('select', { id: 'chain-filter', 'aria-label': 'Filter by chain', onchange: function () { state.chain = this.value; state.page = 1; renderTable(); } });
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
    var catSel = el('select', { id: 'category-filter', 'aria-label': 'Filter by category', onchange: function () { state.category = this.value; state.page = 1; renderTable(); } });
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    filters.appendChild(chainSel);
    filters.appendChild(catSel);
    card.appendChild(filters);
    tableHost = el('div', { class: 'table-wrap' });
    card.appendChild(tableHost);
    pagerHost = el('div', { class: 'pager' });
    card.appendChild(pagerHost);
    app.appendChild(card);
  }

  function sortArrow(key) {
    if (state.sort !== key) return '';
    return state.dir === 1 ? ' ▲' : ' ▼';
  }

  function renderTable() {
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function (t, i) {
      var name = ['all', 'watchlist', 'early', 'live', 'starred'][i];
      t.classList.toggle('is-active', state.tab === name);
      t.setAttribute('aria-selected', state.tab === name ? 'true' : 'false');
    });

    if (state.tab === 'live') { renderLiveTable(); return; }
    var rows = visibleRows();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var pageRows = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    tableHost.innerHTML = '';
    if (!pageRows.length) {
      tableHost.appendChild(el('div', { class: 'empty' },
        el('h3', { text: 'Nothing matches this filter' }),
        el('p', { text: 'Clear the search or pick another chain or category.' })));
    } else {
      var table = el('table', {});
      var head = el('thead', {}, el('tr', {},
        el('th', { class: 'num sortable', text: 'Rank' + sortArrow('rank'), onclick: function () { setSort('rank'); } }),
        el('th', { class: 'sortable', text: 'Protocol' + sortArrow('name'), onclick: function () { setSort('name'); } }),
        el('th', { class: 'num sortable', text: 'TVL' + sortArrow('tvl'), onclick: function () { setSort('tvl'); } }),
        el('th', { class: 'num sortable', text: '7d' + sortArrow('change'), onclick: function () { setSort('change'); } }),
        el('th', { class: 'num sortable', text: 'Age' + sortArrow('age'), onclick: function () { setSort('age'); } }),
        el('th', { class: 'num sortable', text: 'Implied value' + sortArrow('implied'), onclick: function () { setSort('implied'); } }),
        el('th', { text: '' })));
      table.appendChild(head);
      var body = el('tbody', {});
      pageRows.forEach(function (r) {
        var tr = el('tr', { class: state.selected === r.slug ? 'is-selected' : '' });
        tr.appendChild(el('td', { class: 'num rank-cell', text: String(r.rank) }));
        var nameCell = el('td', {},
          el('span', { class: 'cell-name', text: r.name }),
          isWatch(r) ? el('span', { class: 'watch-tag', text: 'Watchlist' }) : null,
          el('div', { class: 'cell-sub', text: r.slug + ', ' + (r.category || 'Uncategorized') + ', ' + chainLabel(r.chains) }));
        tr.appendChild(nameCell);
        tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
        var ch = r.change_7d;
        tr.appendChild(el('td', { class: 'num ' + (ch === null ? '' : ch >= 0 ? 'up' : 'down'), text: fmtPct(ch) }));
        tr.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
        tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
        tr.appendChild(el('td', {},
          el('button', { class: 'row-btn', type: 'button', onclick: function () { openDrawer(r.slug); } }, 'Detail')));
        body.appendChild(tr);
      });
      table.appendChild(body);
      tableHost.appendChild(table);
    }

    pagerHost.innerHTML = '';
    pagerHost.appendChild(el('span', { text: rows.length + ' rows · page ' + state.page + ' of ' + pages }));
    pagerHost.appendChild(el('span', { class: 'spacer' }));
    pagerHost.appendChild(el('button', {
      class: 'btn', type: 'button', disabled: state.page <= 1 ? 'disabled' : null,
      onclick: function () { if (state.page > 1) { state.page--; syncHash(); renderTable(); } },
    }, 'Previous'));
    pagerHost.appendChild(el('button', {
      class: 'btn', type: 'button', disabled: state.page >= pages ? 'disabled' : null,
      onclick: function () { if (state.page < pages) { state.page++; syncHash(); renderTable(); } },
    }, 'Next'));
  }

  function renderLiveTable() {
    tableHost.innerHTML = '';
    var table = el('table', {});
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Protocol' }),
      el('th', { class: 'num', text: 'TVL' }),
      el('th', { class: 'num', text: 'Market cap' }),
      el('th', { class: 'num', text: '7d' }),
      el('th', { text: '' }))));
    var body = el('tbody', {});
    DATA.live.forEach(function (r) {
      var tr = el('tr', {});
      tr.appendChild(el('td', {},
        el('span', { class: 'cell-name', text: r.name }),
        el('div', { class: 'cell-sub', text: r.slug + ', ' + (r.category || 'Uncategorized') + ', ' + chainLabel(r.chains) })));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
      var ch = r.change_7d;
      tr.appendChild(el('td', { class: 'num ' + (ch === null ? '' : ch >= 0 ? 'up' : 'down'), text: fmtPct(ch) }));
      tr.appendChild(el('td', {},
        el('button', { class: 'row-btn', type: 'button', onclick: function () { openLiveDrawer(r.slug); } }, 'Detail')));
      body.appendChild(tr);
    });
    table.appendChild(body);
    tableHost.appendChild(table);
    pagerHost.innerHTML = '';
    pagerHost.appendChild(el('span', { text: DATA.live.length + ' live-token protocols, by market cap. Their tokens already trade — the market sets the price, not this model.' }));
  }

  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
    syncHash();
    renderTable();
  }

  /* ---------- detail drawer ---------- */

  var drawer = document.getElementById('drawer');
  var backdrop = document.getElementById('drawer-backdrop');
  var toast = document.getElementById('toast');
  var toastTimer = null;

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2600);
  }

  function copyText(text, msg) {
    function done() { showToast(msg); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable */ }
    document.body.removeChild(ta);
  }

  function meter(pct) {
    return el('div', { class: 'meter', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.min(100, Math.round(pct * 100))) + '%' }));
  }

  function openDrawer(slug, keepHash) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    drawer.innerHTML = '';
    var head = el('div', { class: 'drawer-head' },
      el('h2', { text: row.name }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close detail', onclick: closeDrawer }, '✕'));
    drawer.appendChild(head);
    drawer.appendChild(el('p', { class: 'drawer-meta', text: row.slug + ', ' + (row.category || 'Uncategorized') + ', ' + (row.chains || []).join(', ') + ', rank #' + row.rank }));
    drawer.appendChild(el('h3', { text: 'Implied value: ' + fmtUsd(row.implied_value_usd) }));
    drawer.appendChild(el('p', { class: 'muted', text: 'What its token could be worth if the protocol’s record stayed as it is. The protocol records no token — that is DefiLlama’s record, not proof it has none.' }));
    drawer.appendChild(el('h3', { text: 'How the number is built' }));
    var kv = el('dl', { class: 'kv' });
    var addKv = function (label, value) {
      kv.appendChild(el('dt', { text: label }));
      kv.appendChild(el('dd', { class: 'num', text: value }));
    };
    addKv('TVL', fmtUsd(row.tvl_usd));
    addKv('7-day change', fmtPct(row.change_7d));
    addKv('Age', fmtAge(row.age_days));
    addKv('Category multiple', '×' + row.category_multiple.toFixed(2));
    addKv('Growth multiplier', '×' + row.growth_multiplier.toFixed(2));
    addKv('Maturity multiplier', '×' + row.maturity_multiplier.toFixed(2));
    addKv('Chain multiplier', '×' + row.chain_multiplier.toFixed(2));
    drawer.appendChild(kv);
    drawer.appendChild(meter(row.implied_value_usd / (DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1)));
    drawer.appendChild(el('p', { class: 'muted', text: 'Bar shows this protocol against rank 1.' }));
    drawer.appendChild(el('h3', { text: 'Farm plan' }));
    var farm = el('ol', { class: 'farm' });
    (row.farm_steps || []).forEach(function (s) { farm.appendChild(el('li', { text: s })); });
    drawer.appendChild(farm);
    drawer.appendChild(el('h3', { text: 'Source record' }));
    drawer.appendChild(el('p', { class: 'link-text', text: 'defillama.com/protocol/' + row.slug }));
    var actions = el('div', { class: 'drawer-actions' });
    actions.appendChild(el('button', {
      class: 'btn', type: 'button',
      onclick: function () { copyText('defillama.com/protocol/' + row.slug, 'Link copied'); },
    }, 'Copy DefiLlama link'));
    var starBtn = el('button', {
      class: 'btn', type: 'button', 'aria-pressed': isStarred(row.slug) ? 'true' : 'false',
      onclick: function () { toggleStar(row.slug); },
    }, isStarred(row.slug) ? '★ Starred' : '☆ Star');
    actions.appendChild(starBtn);
    drawer.appendChild(actions);
    drawer.hidden = false;
    backdrop.hidden = false;
    if (!keepHash) syncHash();
    renderTable();
  }

  function openLiveDrawer(slug) {
    var row = null;
    DATA.live.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    drawer.innerHTML = '';
    drawer.appendChild(el('div', { class: 'drawer-head' },
      el('h2', { text: row.name }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close detail', onclick: closeDrawer }, '✕')));
    drawer.appendChild(el('p', { class: 'drawer-meta', text: row.slug + ', ' + (row.category || 'Uncategorized') + ', ' + (row.chains || []).join(', ') }));
    drawer.appendChild(el('h3', { text: 'Market cap: ' + fmtUsd(row.mcap_usd) }));
    drawer.appendChild(el('p', { class: 'muted', text: 'This protocol’s token already trades. The market sets its price, so the model does not rank it and there is no farm plan for a token that exists.' }));
    var kv = el('dl', { class: 'kv' });
    kv.appendChild(el('dt', { text: 'TVL' })); kv.appendChild(el('dd', { class: 'num', text: fmtUsd(row.tvl_usd) }));
    kv.appendChild(el('dt', { text: '7-day change' })); kv.appendChild(el('dd', { class: 'num', text: fmtPct(row.change_7d) }));
    drawer.appendChild(kv);
    drawer.appendChild(el('h3', { text: 'Source record' }));
    drawer.appendChild(el('p', { class: 'link-text', text: 'defillama.com/protocol/' + row.slug }));
    var actions = el('div', { class: 'drawer-actions' });
    actions.appendChild(el('button', {
      class: 'btn', type: 'button',
      onclick: function () { copyText('defillama.com/protocol/' + row.slug, 'Link copied'); },
    }, 'Copy DefiLlama link'));
    drawer.appendChild(actions);
    drawer.hidden = false;
    backdrop.hidden = false;
  }

  function closeDrawer() {
    state.selected = null;
    drawer.hidden = true;
    backdrop.hidden = true;
    syncHash();
    renderTable();
  }
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
  });

  /* ---------- model sandbox ---------- */

  function renderSandbox() {
    var card = el('section', { class: 'panel', 'aria-label': 'Model sandbox' });
    card.appendChild(el('div', { class: 'panel-head' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { text: 'Move a slider and the page re-ranks live. The submitted board uses the defaults.' })));
    var box = el('div', { class: 'sandbox' });
    var gw = el('label', {}, 'Growth weight — how much a 7-day move matters ',
      el('output', { id: 'gw-out', text: model.growth_weight.toFixed(2) }));
    var gwInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(model.growth_weight), 'aria-label': 'Growth weight' });
    gwInput.addEventListener('input', function () {
      model.growth_weight = parseFloat(gwInput.value);
      document.getElementById('gw-out').textContent = model.growth_weight.toFixed(2);
      state.sandbox = true; state.page = 1; renderTable(); renderSandboxNote();
      updateTopStat(scoredRows()); updateChart(scoredRows());
    });
    gw.appendChild(gwInput);
    var ex = el('label', {}, 'TVL exponent — how much size matters ',
      el('output', { id: 'ex-out', text: model.tvl_exponent.toFixed(2) }));
    var exInput = el('input', { type: 'range', min: '0.85', max: '1', step: '0.01', value: String(model.tvl_exponent), 'aria-label': 'TVL exponent' });
    exInput.addEventListener('input', function () {
      model.tvl_exponent = parseFloat(exInput.value);
      document.getElementById('ex-out').textContent = model.tvl_exponent.toFixed(2);
      state.sandbox = true; state.page = 1; renderTable(); renderSandboxNote();
      updateTopStat(scoredRows()); updateChart(scoredRows());
    });
    ex.appendChild(exInput);
    box.appendChild(gw);
    box.appendChild(ex);
    var row = el('div', { class: 'drawer-actions' });
    row.appendChild(el('button', {
      class: 'btn', type: 'button',
      onclick: function () {
        model.growth_weight = DATA.model.growth_weight;
        model.tvl_exponent = DATA.model.tvl_exponent;
        state.sandbox = false; state.page = 1;
        renderTable(); renderSandboxNote();
        updateTopStat(scoredRows()); updateChart(scoredRows());
        gwInput.value = String(model.growth_weight);
        exInput.value = String(model.tvl_exponent);
        document.getElementById('gw-out').textContent = model.growth_weight.toFixed(2);
        document.getElementById('ex-out').textContent = model.tvl_exponent.toFixed(2);
      },
    }, 'Reset to the submitted model'));
    box.appendChild(row);
    box.appendChild(el('p', { class: 'sandbox-note', id: 'sandbox-note', text: 'Showing the submitted ranking.' }));
    card.appendChild(box);
    app.appendChild(card);
  }
  function renderSandboxNote() {
    var n = document.getElementById('sandbox-note');
    if (n) n.textContent = state.sandbox
      ? 'Sandbox view — growth weight ' + model.growth_weight.toFixed(2) + ', TVL exponent ' + model.tvl_exponent.toFixed(2) + '. The submitted board is unchanged.'
      : 'Showing the submitted ranking.';
  }

  /* ---------- counts, nav, hash ---------- */

  function renderCounts() {
    document.getElementById('nav-watchlist-count').textContent = String(DATA.watchlist_size);
    document.getElementById('nav-starred-count').textContent = String(starred().length);
  }

  function syncHash() {
    var parts = [];
    if (state.tab !== 'all') parts.push('tab=' + state.tab);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.page !== 1) parts.push('page=' + state.page);
    if (state.sort !== 'rank' || state.dir !== 1) parts.push('sort=' + state.sort + ':' + (state.dir === 1 ? 'asc' : 'desc'));
    if (state.selected) parts.push('detail=' + state.selected);
    var hash = parts.length ? '#' + parts.join('&') : '';
    if (window.location.hash !== hash) history.replaceState(null, '', hash || window.location.pathname + window.location.search);
  }

  function applyHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    hash.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = kv[0], v = decodeURIComponent(kv[1] || '');
      if (k === 'tab' && ['all', 'watchlist', 'early', 'live', 'starred'].indexOf(v) >= 0) state.tab = v;
      if (k === 'q') { state.q = v; var s = document.getElementById('search'); if (s) s.value = v; }
      if (k === 'page') { var p = parseInt(v, 10); if (isFinite(p) && p >= 1) state.page = p; }
      if (k === 'sort') {
        var sk = v.split(':');
        if (['rank', 'name', 'tvl', 'change', 'age', 'implied'].indexOf(sk[0]) >= 0) {
          state.sort = sk[0];
          state.dir = sk[1] === 'desc' ? -1 : 1;
        }
      }
      if (k === 'detail') state.selected = v;
    });
  }

  // Scrolling follows the reader's motion setting: smooth unless they asked
  // for reduced motion.
  function scrollToEl(elm) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) elm.scrollIntoView();
    else elm.scrollIntoView({ behavior: 'smooth' });
  }

  document.querySelectorAll('[data-nav]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var nav = btn.getAttribute('data-nav');
      document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      if (nav === 'board') { state.tab = 'all'; }
      else if (nav === 'watchlist' || nav === 'early' || nav === 'live' || nav === 'starred') { state.tab = nav; }
      else if (nav === 'chart') { scrollToEl(document.getElementById('chart')); return; }
      else if (nav === 'model') { scrollToEl(document.getElementById('model')); return; }
      state.page = 1; syncHash(); renderTable();
      scrollToEl(document.getElementById('table-card'));
    });
  });

  document.getElementById('sidebar-toggle').addEventListener('click', function () {
    document.querySelector('.shell').classList.toggle('rail');
  });
  document.getElementById('search').addEventListener('input', function () {
    state.q = this.value.trim(); state.page = 1; syncHash(); renderTable();
  });

  /* ---------- boot ---------- */

  applyHash();
  renderStatic();
  renderTableShell();
  renderTable();
  renderSandbox();
  renderCounts();
  app.appendChild(el('p', { class: 'foot', text: 'Source: DefiLlama protocols endpoint, fetched ' + DATA.as_of + '. “Records no token” means DefiLlama’s record carries none — not proof the protocol has none. Implied values are this entry’s own claim, never make.fun’s.' }));
  if (state.selected) openDrawer(state.selected, true);
  // A filtered view opened from a link lands on the table itself, so the filter
  // is visible at once instead of sitting below the fold. The panel's
  // scroll-margin-top keeps it clear of the sticky top bar.
  if (!state.selected && (state.tab !== 'all' || state.q)) {
    var card = document.getElementById('table-card');
    if (card) card.scrollIntoView();
  }
})();
