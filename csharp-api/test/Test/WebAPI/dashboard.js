const API_BASE = window.location.origin;
let pollCount = 0;

// Health slider state
let isDraggingHealth = false;
let lastKnownMaxHealth = 100;

function row(label, value, cls = '') {
  return `<div class='row'><span class='label'>${label}</span><span class='value ${cls}'>${value}</span></div>`;
}

function fmt(n, d = 2) {
  return n != null ? Number(n).toFixed(d) : '?';
}

function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;') : ''; }

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

async function setPlayerHealth(value) {
  await fetch(API_BASE + '/api/player/health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
}

function updateHealthBar(health, maxHealth) {
  const pct = maxHealth > 0 ? health / maxHealth : 0;
  const color = hpColor(pct);
  const bar = document.getElementById('hp-bar-fill');
  const label = document.getElementById('hp-bar-label');
  if (bar) {
    bar.style.width = (pct * 100) + '%';
    bar.style.background = color;
  }
  if (label) {
    label.textContent = `${fmt(health, 0)} / ${fmt(maxHealth, 0)}`;
  }
}

function onHealthSliderInput(e) {
  const val = parseFloat(e.target.value);
  updateHealthBar(val, lastKnownMaxHealth);
}

function onHealthSliderDown() {
  isDraggingHealth = true;
}

function onHealthSliderUp(e) {
  isDraggingHealth = false;
  const val = parseFloat(e.target.value);
  setPlayerHealth(val);
}

async function updatePlayer() {
  try {
    const d = await fetchJson('/api/player');
    const el = document.getElementById('player-content');
    setDot('player-card', !d.error);
    if (d.error) { el.innerHTML = `<span class='error-msg'>${d.error}</span>`; return; }

    if (d.maxHealth > 0) lastKnownMaxHealth = d.maxHealth;

    // Build health slider row — only rebuild DOM if slider doesn't exist yet
    const slider = document.getElementById('hp-slider');
    if (!slider) {
      el.innerHTML =
        row('Name', d.name || '?', 'highlight') +
        row('Level', d.level) +
        (d.otomoName ? row('Palico', d.otomoName) : '') +
        (d.seikretName ? row('Seikret', d.seikretName) : '') +
        (d.zenny != null ? row('Zenny', d.zenny.toLocaleString() + 'z') : '') +
        (d.points != null ? row('Points', d.points.toLocaleString() + 'p') : '') +
        `<div class='hp-bar-bg'>
          <div class='hp-bar' id='hp-bar-fill'><span id='hp-bar-label'></span></div>
        </div>
        <input type='range' id='hp-slider' class='hp-slider' min='0' max='${d.maxHealth || 100}' step='1' value='${d.health || 0}'>` +
        row('Position', `${fmt(d.position.x)}, ${fmt(d.position.y)}, ${fmt(d.position.z)}`) +
        row('Dist to Camera', fmt(d.distToCamera));

      // Attach events after DOM insertion
      const newSlider = document.getElementById('hp-slider');
      newSlider.addEventListener('input', onHealthSliderInput);
      newSlider.addEventListener('pointerdown', onHealthSliderDown);
      newSlider.addEventListener('pointerup', onHealthSliderUp);
    } else {
      // Update slider max if it changed
      if (d.maxHealth && parseFloat(slider.max) !== d.maxHealth) {
        slider.max = d.maxHealth;
      }

      // Only update slider value if user isn't dragging
      if (!isDraggingHealth) {
        slider.value = d.health;
      }

      // Update non-slider rows by label instead of index
      const rows = el.querySelectorAll('.row');
      for (const r of rows) {
        const lbl = r.querySelector('.label')?.textContent;
        const val = r.querySelector('.value');
        if (!val) continue;
        if (lbl === 'Name') val.textContent = d.name || '?';
        else if (lbl === 'Level') val.textContent = d.level;
        else if (lbl === 'Zenny') val.textContent = d.zenny != null ? d.zenny.toLocaleString() + 'z' : '?';
        else if (lbl === 'Points') val.textContent = d.points != null ? d.points.toLocaleString() + 'p' : '?';
        else if (lbl === 'Position') val.textContent = `${fmt(d.position.x)}, ${fmt(d.position.y)}, ${fmt(d.position.z)}`;
        else if (lbl === 'Dist to Camera') val.textContent = fmt(d.distToCamera);
      }
    }

    // Always update the visual bar (unless dragging, which handles it via onHealthSliderInput)
    if (!isDraggingHealth) {
      updateHealthBar(d.health, d.maxHealth);
    }
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

async function updateLobby() {
  try {
    const d = await fetchJson('/api/lobby');
    const el = document.getElementById('lobby-content');
    setDot('lobby-card', !d.error);
    if (d.error) { el.innerHTML = `<span class='error-msg'>${d.error}</span>`; return; }

    document.getElementById('lobby-count').textContent = `(${d.count})`;

    d.members.sort((a, b) => a.name.localeCompare(b.name));

    el.innerHTML = d.members.map(m => {
      const cls = m.isSelf ? 'is-self' : m.isQuest ? 'is-quest' : '';
      const hr = m.hunterRank > 0 ? `<span class='lobby-hr'>HR${m.hunterRank}</span>` : '';
      return `<div class='lobby-member ${cls}'>
        <span class='lobby-name' title='${m.name}'>${m.name}</span>
        ${hr}
      </div>`;
    }).join('');
  } catch(e) {
    setDot('lobby-card', false);
    document.getElementById('lobby-content').innerHTML = `<span class='error-msg'>${e.message}</span>`;
  }
}

// ── FPS graph ──────────────────────────────────────────────────────
const FPS_HISTORY_SIZE = 120;
const fpsHistory = [];

async function updateFPS() {
  try {
    const d = await fetchJson('/api/camera'); // cheap call we already make
    // deltaTime comes from via.Application — let's use a batch to get it
    const app = await fetchJson('/api/explorer/singleton?typeName=via.Application');
    if (app.error) { setDot('fps-card', false); return; }

    const batch = await (await fetch(API_BASE + '/api/explorer/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [
        { type: 'method', params: { address: app.address, kind: app.kind, typeName: app.typeName, methodName: 'get_DeltaTime' } },
        { type: 'method', params: { address: app.address, kind: app.kind, typeName: app.typeName, methodName: 'get_FrameCount' } }
      ]})
    })).json();

    const dt = parseFloat(batch.results[0].value);
    const fps = dt > 0 ? 1.0 / dt : 0;

    fpsHistory.push(fps);
    if (fpsHistory.length > FPS_HISTORY_SIZE) fpsHistory.shift();

    document.getElementById('fps-value').textContent = `${fps.toFixed(1)} fps`;
    setDot('fps-card', true);
    drawFPSGraph();
  } catch(e) {
    setDot('fps-card', false);
  }
}

// Cache via.Application address and last frame count for FPS calculation
let appAddr = null;
let lastFrameCount = null;
let lastFrameTime = null;

async function updateFPSFast() {
  try {
    if (!appAddr) {
      const app = await fetchJson('/api/explorer/singleton?typeName=via.Application');
      if (app.error) { setDot('fps-card', false); return; }
      appAddr = app;
    }

    const resp = await fetch(API_BASE + '/api/explorer/method?' + new URLSearchParams({
      address: appAddr.address, kind: appAddr.kind, typeName: appAddr.typeName, methodName: 'get_FrameCount'
    }));
    const d = await resp.json();
    if (d.error) { appAddr = null; setDot('fps-card', false); return; }

    const frameCount = parseInt(d.value);
    const now = performance.now();

    if (lastFrameCount !== null && lastFrameTime !== null) {
      const dFrames = frameCount - lastFrameCount;
      const dTime = (now - lastFrameTime) / 1000;
      if (dTime > 0 && dFrames >= 0) {
        const fps = dFrames / dTime;

        fpsHistory.push(fps);
        if (fpsHistory.length > FPS_HISTORY_SIZE) fpsHistory.shift();

        document.getElementById('fps-value').textContent = `${fps.toFixed(1)} fps`;
        setDot('fps-card', true);
        drawFPSGraph();
      }
    }

    lastFrameCount = frameCount;
    lastFrameTime = now;
  } catch(e) {
    setDot('fps-card', false);
  }
}

function drawFPSGraph() {
  const canvas = document.getElementById('fps-canvas');
  if (!canvas) return;

  // Resize canvas to fill card width
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width - 40; // account for card padding

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (fpsHistory.length < 2) return;

  const maxFps = Math.max(90, ...fpsHistory);
  const minFps = Math.min(...fpsHistory);

  // Draw target lines
  for (const target of [30, 60]) {
    if (target > maxFps) continue;
    const y = h - (target / maxFps) * h;
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#484f58';
    ctx.font = '10px monospace';
    ctx.fillText(target + '', 2, y - 2);
  }

  // Draw FPS line
  const step = w / (FPS_HISTORY_SIZE - 1);
  const startIdx = FPS_HISTORY_SIZE - fpsHistory.length;

  ctx.beginPath();
  for (let i = 0; i < fpsHistory.length; i++) {
    const x = (startIdx + i) * step;
    const y = h - (fpsHistory[i] / maxFps) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Fill under the line
  const lastX = (startIdx + fpsHistory.length - 1) * step;
  const firstX = startIdx * step;
  ctx.lineTo(lastX, h);
  ctx.lineTo(firstX, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(88, 166, 255, 0.08)';
  ctx.fill();

  // Color the current value
  const current = fpsHistory[fpsHistory.length - 1];
  const dotColor = current >= 55 ? '#3fb950' : current >= 30 ? '#d29922' : '#f85149';
  const dotX = lastX;
  const dotY = h - (current / maxFps) * h;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();
}

// ── Weather ────────────────────────────────────────────────────────

const weatherIcons = {
  Fertility: '🌿', Devastation: '💀', Abnormal: '⚠️', SandStorm: '🏜️',
  HeavyRain: '🌧️', Magma: '🌋', Blizzard: '❄️', Energy: '⚡',
  Junction: '🌀', LastBossPhase1: '👁️', LastBossPhase2: '👁️',
  Live: '🎵', MagmaBossPhase2: '🌋'
};

async function updateWeather() {
  try {
    const d = await fetchJson('/api/weather');
    const el = document.getElementById('weather-content');
    setDot('weather-card', !d.error);
    if (d.error) { el.innerHTML = `<span class='error-msg'>${d.error}</span>`; return; }

    const icon = weatherIcons[d.current] || '🌤️';
    const clockIcons = { MORNING: '🌅', NOON: '☀️', EVENING: '🌇', NIGHT: '🌙', MIDNIGHT: '🌑' };
    const clockIcon = clockIcons[d.timeZone] || '🕐';

    let html = `<div class='weather-current'><span class='weather-icon'>${icon}</span><span class='weather-name'>${d.current || '?'}</span></div>`;
    html += `<div class='weather-clock'>${clockIcon} ${d.clock || '??:??'} <span class='weather-timezone'>${d.timeZone || ''}</span></div>`;

    if (d.next && d.next !== 'None') {
      const nextIcon = weatherIcons[d.next] || '🌤️';
      html += `<div class='weather-next'>Transitioning to: ${nextIcon} ${d.next}</div>`;
    }

    // Show blend bars for active weather types
    const active = (d.blends || []).filter(b => b.blendRate > 0.001);
    if (active.length > 0) {
      html += `<div class='weather-blends'>`;
      for (const b of active) {
        const pct = (b.blendRate * 100).toFixed(0);
        const bIcon = weatherIcons[b.name] || '';
        html += `<div class='weather-blend-row'>
          <span class='weather-blend-label'>${bIcon} ${b.name}</span>
          <div class='weather-blend-bar-bg'><div class='weather-blend-bar' style='width:${pct}%'></div></div>
          <span class='weather-blend-pct'>${pct}%</span>
        </div>`;
      }
      html += `</div>`;
    }

    el.innerHTML = html;
  } catch(e) {
    setDot('weather-card', false);
  }
}

// ── Map / Location ─────────────────────────────────────────────────

function formatSeconds(s) {
  if (s == null) return '?';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

async function updateMap() {
  try {
    const d = await fetchJson('/api/map');
    const el = document.getElementById('map-content');
    setDot('map-card', !d.error);
    if (d.error) { el.innerHTML = `<span class='error-msg'>${d.error}</span>`; return; }

    let html = row('Stage', `${d.stageName}`, 'highlight') +
               row('Stage Code', d.stage) +
               row('Area No.', d.areaNo);

    if (d.prevStage && d.prevStage !== 'INVALID') {
      html += row('Previous', d.prevStageName);
    }

    if (d.quest && d.quest.active) {
      html += `<div style='margin-top:8px;padding-top:8px;border-top:1px solid #21262d'>`;
      html += row('Quest', d.quest.id || '?', 'warn');
      if (d.quest.playing) {
        html += row('Status', 'In Progress', 'highlight');
        if (d.quest.remainTime != null) html += row('Time Left', formatSeconds(d.quest.remainTime), d.quest.remainTime < 300 ? 'warn' : '');
        if (d.quest.elapsedTime != null) html += row('Elapsed', formatSeconds(d.quest.elapsedTime));
      } else {
        html += row('Status', 'Accepted');
      }
      if (d.quest.beforeStage) html += row('Departed From', d.quest.beforeStage);
      html += `</div>`;
    }

    el.innerHTML = html;
  } catch(e) {
    setDot('map-card', false);
    document.getElementById('map-content').innerHTML = `<span class='error-msg'>${e.message}</span>`;
  }
}

// ── Equipment ──────────────────────────────────────────────────────

const weaponIcons = {
  GREAT_SWORD: '🗡️', LONG_SWORD: '⚔️', SWORD_AND_SHIELD: '🛡️', DUAL_BLADES: '🔪',
  HAMMER: '🔨', HUNTING_HORN: '🎺', LANCE: '🔱', GUN_LANCE: '💥',
  SWITCH_AXE: '🪓', CHARGE_AXE: '⚡', INSECT_GLAIVE: '🦗', LIGHT_BOWGUN: '🔫',
  HEAVY_BOWGUN: '💣', BOW: '🏹'
};

const elementColors = {
  FIRE: '#f85149', WATER: '#58a6ff', THUNDER: '#d29922', ICE: '#79c0ff',
  DRAGON: '#a371f7', POISON: '#bc8cff', SLEEP: '#7ee787', PARALYSIS: '#e3b341',
  BLAST: '#f0883e'
};

function slotGems(slots) {
  if (!slots) return '';
  return slots.map(s => s > 0 ? `<span class='equip-gem equip-gem-${s}' title='Lv${s}'>${s}</span>` : '').join('');
}

async function updateEquipment() {
  try {
    const d = await fetchJson('/api/equipment');
    const el = document.getElementById('equip-content');
    setDot('equip-card', !d.error);
    if (d.error) { el.innerHTML = `<span class='error-msg'>${d.error}</span>`; return; }

    const w = d.weapon;
    const wIcon = weaponIcons[w.type] || '⚔️';
    const elemColor = elementColors[w.element] || '#8b949e';
    const hasElem = w.element && w.element !== 'NONE';
    const hasSub = w.subElement && w.subElement !== 'NONE';
    const rare = w.rarity ? w.rarity.replace('RARE', 'R') : '?';

    const wTip = w.description ? ` data-tip="${esc(w.description)}"` : '';
    let html = `<div class='equip-weapon'${wTip}>
      <span style='font-size:1.4em'>${wIcon}</span>
      <div style='flex:1'>
        <div class='equip-weapon-name'>${w.name}</div>
        <div class='equip-weapon-type'>${w.type} &middot; ${rare}</div>
      </div>
      <div class='equip-slots'>${slotGems(w.slots)}</div>
    </div>`;

    html += `<div class='equip-stats'>`;
    html += `<div class='equip-stat'><span class='equip-stat-label'>ATK</span><span class='equip-stat-val'>${w.attack}</span></div>`;
    html += `<div class='equip-stat'><span class='equip-stat-label'>Affinity</span><span class='equip-stat-val' style='color:${w.critical > 0 ? '#3fb950' : w.critical < 0 ? '#f85149' : '#c9d1d9'}'>${w.critical > 0 ? '+' : ''}${w.critical}%</span></div>`;
    if (hasElem) {
      html += `<div class='equip-stat'><span class='equip-stat-label' style='color:${elemColor}'>${w.element}</span><span class='equip-stat-val' style='color:${elemColor}'>${w.elementValue}</span></div>`;
    }
    if (hasSub) {
      const subColor = elementColors[w.subElement] || '#8b949e';
      html += `<div class='equip-stat'><span class='equip-stat-label' style='color:${subColor}'>${w.subElement}</span><span class='equip-stat-val' style='color:${subColor}'>${w.subElementValue}</span></div>`;
    }
    if (w.defense > 0) {
      html += `<div class='equip-stat'><span class='equip-stat-label'>DEF</span><span class='equip-stat-val'>+${w.defense}</span></div>`;
    }
    html += `</div>`;

    html += `<div class='equip-armor-list'>`;
    const slotIcons = { Helm: '🪖', Body: '👕', Arms: '🧤', Waist: '🩳', Legs: '🥾' };
    for (const a of d.armor) {
      const lvl = a.upgradeLevel > 0 ? `Lv${a.upgradeLevel}` : '';
      const icon = slotIcons[a.slot] || '';
      const aTip = a.description ? ` data-tip="${esc(a.description)}"` : '';
      html += `<div class='equip-armor-piece'${aTip}>
        <span class='equip-slot'>${icon} ${a.slot}</span>
        <span class='equip-name'>${a.name}</span>
        <span class='equip-level'>${lvl}</span>
      </div>`;
    }
    html += `</div>`;

    if (d.palico) {
      const p = d.palico;
      html += `<div style='margin-top:12px;padding-top:10px;border-top:1px solid #21262d'>
        <div style='color:#8b949e;font-size:0.8em;margin-bottom:6px'>Palico</div>
        <div class='equip-armor-list'>`;
      const pSlots = [
        { icon: '🗡️', label: 'Weapon', piece: p.weapon },
        { icon: '🪖', label: 'Helm', piece: p.helm },
        { icon: '👕', label: 'Body', piece: p.body }
      ];
      for (const s of pSlots) {
        const r = s.piece.rarity ? s.piece.rarity.replace('RARE', 'R') : '';
        const pTip = s.piece.description ? ` data-tip="${esc(s.piece.description)}"` : '';
        html += `<div class='equip-armor-piece'${pTip}>
          <span class='equip-slot'>${s.icon} ${s.label}</span>
          <span class='equip-name'>${s.piece.name}</span>
          <span class='equip-level'>${r}</span>
        </div>`;
      }
      html += `</div></div>`;
    }

    el.innerHTML = html;
  } catch(e) {
    setDot('equip-card', false);
    document.getElementById('equip-content').innerHTML = `<span class='error-msg'>${e.message}</span>`;
  }
}

// ── Inventory ───────────────────────────────────────────────────────

async function updateInventory() {
  try {
    const d = await fetchJson('/api/inventory');
    const el = document.getElementById('inventory-content');
    setDot('inventory-card', !d.error);
    if (d.error) { el.innerHTML = `<span class='error-msg'>${d.error}</span>`; return; }

    document.getElementById('inventory-count').textContent = `(${d.count}/${d.capacity})`;

    if (!d.items || d.items.length === 0) {
      el.innerHTML = `<span class='error-msg'>Empty</span>`;
      return;
    }

    el.innerHTML = d.items.map(item => {
      return `<div class='inv-item'>
        <span class='inv-name'>${item.name}</span>
        <span class='inv-qty'>x${item.quantity}</span>
      </div>`;
    }).join('');
  } catch(e) {
    setDot('inventory-card', false);
    document.getElementById('inventory-content').innerHTML = `<span class='error-msg'>${e.message}</span>`;
  }
}

// ── Mesh Visibility ─────────────────────────────────────────────────

async function toggleMesh(name, visible) {
  await fetch(API_BASE + '/api/meshes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, visible })
  });
}

async function updateMeshes() {
  try {
    const d = await fetchJson('/api/meshes');
    const el = document.getElementById('mesh-content');
    setDot('mesh-card', !d.error);
    if (d.error) { el.innerHTML = `<span class='error-msg'>${d.error}</span>`; return; }

    if (!d.meshes || d.meshes.length === 0) {
      el.innerHTML = `<span class='error-msg'>No meshes found</span>`;
      return;
    }

    // Only rebuild DOM if mesh count changed
    const existing = el.querySelectorAll('.mesh-toggle');
    if (existing.length !== d.meshes.length) {
      el.innerHTML = d.meshes.map(m => {
        const checked = m.visible ? 'checked' : '';
        return `<label class='mesh-toggle'>
          <input type='checkbox' ${checked} data-mesh='${esc(m.name)}'>
          <span class='mesh-label'>${m.label}</span>
          <span class='mesh-name'>${m.name}</span>
        </label>`;
      }).join('');

      el.addEventListener('change', e => {
        const cb = e.target;
        if (cb.dataset.mesh) toggleMesh(cb.dataset.mesh, cb.checked);
      });
    } else {
      // Update checkbox states without rebuilding
      for (const m of d.meshes) {
        const cb = el.querySelector(`input[data-mesh="${m.name}"]`);
        if (cb && cb !== document.activeElement) cb.checked = m.visible;
      }
    }
  } catch(e) {
    setDot('mesh-card', false);
    document.getElementById('mesh-content').innerHTML = `<span class='error-msg'>${e.message}</span>`;
  }
}

async function poll() {
  pollCount++;
  const start = performance.now();
  await Promise.all([updatePlayer(), updateCamera(), updateFPSFast()]);
  const ms = (performance.now() - start).toFixed(0);
  document.getElementById('poll-info').textContent = `Poll #${pollCount} | ${ms}ms | ${new Date().toLocaleTimeString()}`;
}

// Fast-polling data (player, camera) every 500ms
setInterval(poll, 500);

// Medium-polling data (lobby, weather, equipment, map) every 5s
updateLobby();
updateWeather();
updateEquipment();
updateInventory();
updateMeshes();
updateMap();
setInterval(updateLobby, 5000);
setInterval(updateWeather, 5000);
setInterval(updateEquipment, 5000);
setInterval(updateInventory, 5000);
setInterval(updateMeshes, 5000);
setInterval(updateMap, 5000);

// Initial fast poll
poll();

// ── Tooltip for [data-tip] elements ──────────────────────────────
(function() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  document.body.appendChild(tip);

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.classList.remove('show'); return; }
    tip.textContent = el.dataset.tip;
    tip.classList.add('show');
    positionTip(e);
  });

  document.addEventListener('mousemove', e => {
    if (tip.classList.contains('show')) positionTip(e);
  });

  document.addEventListener('mouseout', e => {
    const el = e.target.closest('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) tip.classList.remove('show');
  });

  function positionTip(e) {
    const pad = 12;
    let x = e.clientX + pad, y = e.clientY + pad;
    tip.style.left = '0'; tip.style.top = '0';
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight) y = e.clientY - r.height - pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
})();
