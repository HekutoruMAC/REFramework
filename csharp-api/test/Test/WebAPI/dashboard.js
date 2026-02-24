const API_BASE = window.location.origin;
let pollCount = 0;

function row(label, value, cls = '') {
  return `<div class='row'><span class='label'>${label}</span><span class='value ${cls}'>${value}</span></div>`;
}

function fmt(n, d = 2) {
  return n != null ? Number(n).toFixed(d) : '?';
}

function hpColor(pct) {
  if (pct > 0.6) return '#3fb950';
  if (pct > 0.3) return '#d29922';
  return '#f85149';
}

function setDot(cardId, ok) {
  const dot = document.querySelector(`#${cardId} .dot`);
  if (dot) dot.className = ok ? 'dot' : 'dot error';
}

async function fetchJson(path) {
  const r = await fetch(API_BASE + path);
  return r.json();
}

async function updatePlayer() {
  try {
    const d = await fetchJson('/api/player');
    const el = document.getElementById('player-content');
    setDot('player-card', !d.error);
    if (d.error) { el.innerHTML = `<span class='error-msg'>${d.error}</span>`; return; }

    const pct = d.maxHealth > 0 ? d.health / d.maxHealth : 0;
    const color = hpColor(pct);

    el.innerHTML =
      row('Name', d.name || '?', 'highlight') +
      row('Level', d.level) +
      `<div class='hp-bar-bg'><div class='hp-bar' style='width:${pct*100}%;background:${color}'>${fmt(d.health,0)} / ${fmt(d.maxHealth,0)}</div></div>` +
      row('Position', `${fmt(d.position.x)}, ${fmt(d.position.y)}, ${fmt(d.position.z)}`) +
      row('Dist to Camera', fmt(d.distToCamera));
  } catch(e) {
    setDot('player-card', false);
    document.getElementById('player-content').innerHTML = `<span class='error-msg'>${e.message}</span>`;
  }
}

async function updateCamera() {
  try {
    const d = await fetchJson('/api/camera');
    const el = document.getElementById('camera-content');
    setDot('camera-card', !d.error);
    if (d.error) { el.innerHTML = `<span class='error-msg'>${d.error}</span>`; return; }
    el.innerHTML =
      row('Position', `${fmt(d.position.x)}, ${fmt(d.position.y)}, ${fmt(d.position.z)}`) +
      row('FOV', fmt(d.fov, 1) + '\u00B0') +
      row('Near Clip', fmt(d.nearClip, 3)) +
      row('Far Clip', fmt(d.farClip, 1));
  } catch(e) {
    setDot('camera-card', false);
  }
}

async function updateTDB() {
  try {
    const d = await fetchJson('/api/tdb');
    const el = document.getElementById('tdb-content');
    setDot('tdb-card', true);
    el.innerHTML =
      row('Types', d.types?.toLocaleString()) +
      row('Methods', d.methods?.toLocaleString()) +
      row('Fields', d.fields?.toLocaleString()) +
      row('Properties', d.properties?.toLocaleString()) +
      row('Strings', d.stringsKB?.toLocaleString() + ' KB') +
      row('Raw Data', d.rawDataKB?.toLocaleString() + ' KB');
  } catch(e) {
    setDot('tdb-card', false);
  }
}

let singletonData = [];

async function updateSingletons() {
  try {
    const d = await fetchJson('/api/singletons');
    setDot('singleton-card', true);
    singletonData = d.singletons || [];
    document.getElementById('singleton-count').textContent = `(${d.count})`;
    renderSingletons();
  } catch(e) {
    setDot('singleton-card', false);
  }
}

function renderSingletons() {
  const filter = document.getElementById('singleton-search').value.toLowerCase();
  const el = document.getElementById('singleton-content');
  const filtered = singletonData.filter(s => s.type.toLowerCase().includes(filter));

  el.innerHTML = filtered.map(s =>
    `<div class='singleton-item'>
      <span class='singleton-name'>${s.type}</span>
      <span class='singleton-meta'>${s.address} | ${s.methods}m ${s.fields}f</span>
    </div>`
  ).join('');
}

document.getElementById('singleton-search').addEventListener('input', renderSingletons);

async function poll() {
  pollCount++;
  const start = performance.now();
  await Promise.all([updatePlayer(), updateCamera()]);
  const ms = (performance.now() - start).toFixed(0);
  document.getElementById('poll-info').textContent = `Poll #${pollCount} | ${ms}ms | ${new Date().toLocaleTimeString()}`;
}

// Fast-polling data (player, camera) every 500ms
setInterval(poll, 500);

// Slow-polling data (TDB, singletons) once then every 10s
updateTDB();
updateSingletons();
setInterval(updateTDB, 10000);
setInterval(updateSingletons, 10000);

// Initial fast poll
poll();
