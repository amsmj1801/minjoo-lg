(() => {
  const VIEW_W = 402, VIEW_H = 874;
  const byId = Object.fromEntries(SCREENS.map(s => [s.id, s]));
  const START = FLOWS[0].start;

  const viewport = document.getElementById('viewport');
  const device = document.getElementById('device');
  const flowsNav = document.getElementById('flows');
  const where = document.getElementById('where');
  const hints = document.getElementById('chk-hints');

  let current = null;   // { s, el }
  let stack = [];       // history of screen ids
  let timer = null;
  let flashTimer = null;

  // ---------- Fit the device to the window ----------
  function fit() {
    const small = window.matchMedia('(max-width: 760px)').matches;
    const pad = small ? 0 : 48;
    const frame = small ? 0 : 28;
    const stage = document.getElementById('stage').getBoundingClientRect();
    const s = Math.min((stage.width - pad) / (VIEW_W + frame), (stage.height - pad) / (VIEW_H + frame), 1.25);
    device.style.setProperty('--s', Math.max(s, 0.3).toFixed(4));
  }
  window.addEventListener('resize', fit);

  // ---------- Flow menu ----------
  // Each screen belongs to the first flow that reaches it without passing through another flow's start.
  const flowOf = {};
  const starts = new Set(FLOWS.map(f => f.start));
  FLOWS.forEach(f => {
    const queue = [f.start];
    while (queue.length) {
      const id = queue.shift();
      if (flowOf[id] || (id !== f.start && starts.has(id))) continue;
      flowOf[id] = f;
      const s = byId[id];
      if (!s) continue;
      s.hs.forEach(h => { if (h.to !== 'BACK') queue.push(h.to); });
      if (s.fixed) queue.push(s.fixed.to);
      if (s.auto) queue.push(s.auto[0]);
    }
  });

  let lastRole = null, lastSection = null;
  FLOWS.forEach(f => {
    if (f.role !== lastRole) {
      const h = document.createElement('h2');
      h.className = 'role';
      h.innerHTML = f.role === 'Club admin'
        ? 'Club admin <small>for club organisers</small>'
        : 'Member app <small>for students</small>';
      flowsNav.appendChild(h);
      lastRole = f.role;
    }
    if (f.section !== lastSection) {
      const h = document.createElement('h3');
      h.textContent = f.section;
      flowsNav.appendChild(h);
      lastSection = f.section;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'flow';
    b.dataset.start = f.start;
    b.innerHTML = `<span class="t"></span><span class="d"></span>`;
    b.querySelector('.t').textContent = f.title;
    b.querySelector('.d').textContent = f.desc;
    b.addEventListener('click', () => {
      go(f.start, { reset: true });
      document.body.classList.remove('drawer');
    });
    flowsNav.appendChild(b);
  });

  function markFlow(id) {
    const f = flowOf[id];
    flowsNav.querySelectorAll('button.flow').forEach(b => {
      const on = !!f && b.dataset.start === f.start;
      if (on && !b.classList.contains('on')) b.scrollIntoView({ block: 'nearest' });
      b.classList.toggle('on', on);
    });
    where.innerHTML = f
      ? `<span class="sec"></span><strong></strong><span class="scr"></span>`
      : `<strong></strong><span class="scr"></span>`;
    if (f) where.querySelector('.sec').textContent = f.section;
    where.querySelector('strong').textContent = f ? f.title : 'Club X';
    where.querySelector('.scr').textContent = 'Screen: ' + byId[id].name;
  }

  // ---------- Rendering ----------
  const preloaded = new Set();
  function preload(id) {
    const s = byId[id];
    if (!s || preloaded.has(id)) return;
    preloaded.add(id);
    new Image().src = s.img;
  }

  function build(s) {
    const k = VIEW_W / s.w;                       // frame px -> viewport px
    const el = document.createElement('div');
    el.className = 'screen';
    const content = document.createElement('div');
    content.className = 'content';
    content.style.height = Math.max(VIEW_H, s.h * k) + 'px';

    const img = document.createElement('img');
    img.className = 'shot';
    img.src = s.img;
    img.alt = s.name;
    img.style.left = (s.ox * k) + 'px';
    img.style.width = (s.iw * k) + 'px';
    content.appendChild(img);

    // Bigger areas first so smaller buttons sit on top of them
    [...s.hs].sort((a, b) => b.w * b.h - a.w * a.h).forEach(h => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hs';
      b.setAttribute('aria-label', h.to === 'BACK' ? 'Back' : (byId[h.to]?.name || h.to));
      Object.assign(b.style, {
        left: h.x * k + 'px', top: h.y * k + 'px',
        width: h.w * k + 'px', height: h.h * k + 'px',
      });
      b.addEventListener('click', e => {
        e.stopPropagation();
        h.to === 'BACK' ? back() : go(h.to);
      });
      content.appendChild(b);
      if (h.to !== 'BACK') preload(h.to);
    });

    el.appendChild(content);

    if (s.fixed) {
      const f = s.fixed, fk = VIEW_W / s.w;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fixed hs';
      b.setAttribute('aria-label', byId[f.to]?.name || f.to);
      Object.assign(b.style, {
        left: f.x * fk + 'px', top: f.y * fk + 'px', width: f.w * fk + 'px', height: f.h * fk + 'px',
        backgroundImage: `url("${f.src}")`,
        backgroundSize: `${f.srcW * fk}px auto`,
        backgroundPosition: `${(f.srcOx - f.x) * fk}px ${-f.y * fk}px`,
      });
      b.addEventListener('click', e => { e.stopPropagation(); go(f.to); });
      // fixed layer lives outside the scroller
      el._fixed = b;
      preload(f.to);
    }

    el.addEventListener('click', () => {
      // Figma-style: tapping a dead area flashes the hotspots
      viewport.classList.remove('flash');
      void viewport.offsetWidth;
      viewport.classList.add('flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => viewport.classList.remove('flash'), 650);
    });
    return el;
  }

  function show(id, dir) {
    const s = byId[id];
    if (!s) return;
    clearTimeout(timer);
    const prev = current;
    const el = build(s);
    const sameFamily = prev && baseName(prev.s.name) === baseName(s.name);
    el.classList.add(sameFamily ? 'same' : 'enter');
    if (dir === 'back' && !sameFamily) el.classList.add('back');
    viewport.appendChild(el);
    if (el._fixed) viewport.appendChild(el._fixed);

    // Keep the scroll position when moving between states of the same long page
    if (prev && prev.s.h > VIEW_H + 4 && s.h > VIEW_H + 4) el.scrollTop = prev.el.scrollTop;

    if (prev) {
      setTimeout(() => {
        prev.el.remove();
        prev.el._fixed?.remove();
      }, 240);
    }
    current = { s, el };
    viewport.dataset.screen = id;
    markFlow(id);
    document.title = `${s.name} · LG Prototype`;
    history.replaceState(null, '', '#' + id.replace(':', '-'));

    if (s.auto) timer = setTimeout(() => go(s.auto[0]), s.auto[1] * 1000);
  }

  function baseName(n) { return n.replace(/\(.*$/, '').replace(/-\s*\d+$/, '').trim(); }

  function go(id, opts = {}) {
    if (!byId[id]) return;
    if (current && !opts.reset && !current.s.auto) stack.push(current.s.id);
    if (opts.reset) stack = [];
    show(id, 'fwd');
  }

  function back() {
    const id = stack.pop();
    if (id) show(id, 'back');
  }

  function restart() {
    stack = [];
    go(START, { reset: true });
  }

  // ---------- Controls ----------
  document.getElementById('btn-back').addEventListener('click', back);
  document.getElementById('btn-restart').addEventListener('click', restart);
  document.getElementById('btn-tour').addEventListener('click', () => { restart(); document.body.classList.remove('drawer'); });
  document.getElementById('menu').addEventListener('click', e => {
    e.stopPropagation();
    document.body.classList.toggle('drawer');
  });
  document.getElementById('stage').addEventListener('click', e => {
    if (e.target.id === 'stage') document.body.classList.remove('drawer');
  });

  try { hints.checked = localStorage.getItem('clubx-hints') === '1'; } catch (_) {}
  const applyHints = () => viewport.classList.toggle('hints', hints.checked);
  hints.addEventListener('change', () => {
    applyHints();
    try { localStorage.setItem('clubx-hints', hints.checked ? '1' : '0'); } catch (_) {}
  });
  applyHints();

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); back(); }
    else if (e.key.toLowerCase() === 'r') restart();
    else if (e.key.toLowerCase() === 'h') { hints.checked = !hints.checked; hints.dispatchEvent(new Event('change')); }
  });

  // ---------- Start ----------
  fit();
  const fromHash = location.hash.slice(1).replace('-', ':');
  if (byId[fromHash]) go(fromHash, { reset: true });
  else {
    restart();
    // First visit on a phone: show the guide/menu first
    if (window.matchMedia('(max-width: 760px)').matches) document.body.classList.add('drawer');
  }
  window.clubx = { go: id => go(id, { reset: true }), back };
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1).replace('-', ':');
    if (byId[id] && id !== current?.s.id) go(id, { reset: true });
  });
})();
