/* Beta — climbing trainer PWA — vanilla JS, no build step.
 * Data lives in localStorage on the device. No server, no accounts.
 */
'use strict';

const LS_ACTIVE = 'ct_active_session';
const LS_HISTORY = 'ct_history';
const LS_OVERRIDES = 'ct_overrides'; // per-exercise user overrides: { exId: { durationSec?, restSec? } }
const LS_TEMPLATE = 'ct_week_template'; // legacy recurring template — migrated into LS_WEEK_PLANS on boot
const LS_WEEK_PLANS = 'ct_week_plans'; // per-calendar-week plans: { "2026-W28": { mon: [blockId, ...], ... }, ... }
const LS_CUSTOM_BLOCKS = 'ct_custom_blocks'; // user-built blocks: full block objects with copied exercises
const LS_CUSTOM_EXERCISES = 'ct_custom_exercises'; // user-created library exercises
const LS_HIDDEN = 'ct_hidden_blocks'; // bundled block ids hidden from the picker and week planner
const LS_TABATA = 'ct_tabata'; // last-used tabata config: { workSec, restSec, rounds }

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const todayKey = () => DAY_KEYS[(new Date().getDay() + 6) % 7]; // JS Sunday=0 → our Monday-first keys

let schedule = null;          // loaded from schedule.json
let selectedBlockIds = [];    // picker state
let currentTab = 'train';

const $view = document.getElementById('view');
const $restBanner = document.getElementById('rest-banner');
const $dialogRoot = document.getElementById('dialog-root');

/* ---------------- storage ---------------- */

function loadActive() {
  try { return JSON.parse(localStorage.getItem(LS_ACTIVE)); } catch { return null; }
}
function saveActive(s) {
  if (s) localStorage.setItem(LS_ACTIVE, JSON.stringify(s));
  else localStorage.removeItem(LS_ACTIVE);
}
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { return []; }
}
function saveHistory(h) {
  localStorage.setItem(LS_HISTORY, JSON.stringify(h));
}
function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_OVERRIDES)) || {}; } catch { return {}; }
}
function saveOverride(exId, patch) {
  const o = loadOverrides();
  o[exId] = { ...o[exId], ...patch };
  localStorage.setItem(LS_OVERRIDES, JSON.stringify(o));
}
function loadWeekPlans() {
  try { return JSON.parse(localStorage.getItem(LS_WEEK_PLANS)) || {}; } catch { return {}; }
}
function saveWeekPlans(plans) {
  // Prune plans older than ~8 weeks; zero-padded keys sort correctly as strings.
  const cutoff = isoWeekKey(new Date(Date.now() - 8 * 7 * 86400000));
  for (const key of Object.keys(plans)) if (key < cutoff) delete plans[key];
  localStorage.setItem(LS_WEEK_PLANS, JSON.stringify(plans));
}

// ISO-8601 week key, e.g. "2026-W28" (nearest-Thursday rule).
function isoWeekKey(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const isoYear = t.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() + 3 - ((firstThu.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((t - firstThu) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

// Monday of the week `offsetWeeks` from the current one, local midnight.
function weekStart(offsetWeeks) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + offsetWeeks * 7);
}

// One-time migration: the old recurring template becomes this week's plan.
function migrateLegacyTemplate() {
  try {
    const old = localStorage.getItem(LS_TEMPLATE);
    if (old && !localStorage.getItem(LS_WEEK_PLANS)) {
      localStorage.setItem(LS_WEEK_PLANS, JSON.stringify({ [isoWeekKey(new Date())]: JSON.parse(old) }));
    }
    if (old) localStorage.removeItem(LS_TEMPLATE);
  } catch {}
}
function loadCustomBlocks() {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_BLOCKS)) || []; } catch { return []; }
}
function saveCustomBlocks(blocks) {
  localStorage.setItem(LS_CUSTOM_BLOCKS, JSON.stringify(blocks));
}
function loadCustomExercises() {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_EXERCISES)) || []; } catch { return []; }
}
function saveCustomExercises(list) {
  localStorage.setItem(LS_CUSTOM_EXERCISES, JSON.stringify(list));
}
function allBlocks() {
  // Custom entries with a bundled id shadow (replace) the bundled block in place;
  // genuinely new custom blocks append at the end.
  const custom = loadCustomBlocks();
  const byId = new Map(custom.map((b) => [b.id, b]));
  const merged = schedule.blocks.map((b) => byId.get(b.id) || b);
  const extras = custom.filter((b) => !schedule.blocks.some((s) => s.id === b.id));
  return [...merged, ...extras];
}
function isBundledId(id) {
  return schedule.blocks.some((b) => b.id === id);
}
function loadHidden() {
  try { return JSON.parse(localStorage.getItem(LS_HIDDEN)) || []; } catch { return []; }
}
function saveHidden(ids) {
  localStorage.setItem(LS_HIDDEN, JSON.stringify(ids));
}
function visibleBlocks() {
  const hidden = loadHidden();
  return allBlocks().filter((b) => !hidden.includes(b.id));
}
function deleteBlock(id) {
  // Custom blocks (and shadow copies of edited bundled ones) are destroyed outright.
  // Bundled blocks ship inside the app, so "delete" tombstones them in LS_HIDDEN;
  // the picker's "Restore standard blocks" button clears the tombstones.
  saveCustomBlocks(loadCustomBlocks().filter((b) => b.id !== id));
  if (isBundledId(id)) saveHidden([...new Set([...loadHidden(), id])]);
  // A deleted block shouldn't linger in plans or the current selection.
  const plans = loadWeekPlans();
  for (const week of Object.values(plans))
    for (const day of DAY_KEYS) if (week[day]) week[day] = week[day].filter((b) => b !== id);
  saveWeekPlans(plans);
  selectedBlockIds = selectedBlockIds.filter((b) => b !== id);
}

// Every known exercise (bundled blocks + library extras + user-created), deduped by id, grouped later by category.
function libraryExercises() {
  const seen = new Set();
  const out = [];
  for (const ex of [...schedule.blocks.flatMap((b) => b.exercises), ...(schedule.library || []), ...loadCustomExercises()]) {
    if (seen.has(ex.id)) continue;
    seen.add(ex.id);
    out.push(ex);
  }
  return out;
}

// Rough per-block minutes: setup + sets × (work + rest), matching the spirit of the Android time formula.
function estimateDurationMin(exercises) {
  let sec = 0;
  for (const ex of exercises) {
    const sides = ex.per_side ? 2 : 1;
    const work = ex.metric === 'TIME' ? ex.duration_sec * sides : 40;
    sec += 60 + ex.sets * (work + (ex.rest_sec || 60));
  }
  return Math.max(5, Math.round(sec / 60));
}

// Today's planned block ids from THIS week's plan, filtered to blocks that still exist and aren't hidden.
function todaysPlannedBlockIds() {
  const plan = loadWeekPlans()[isoWeekKey(new Date())] || {};
  const planned = plan[todayKey()] || [];
  return planned.filter((id) => visibleBlocks().some((b) => b.id === id));
}

/* ---------------- audio (unlocked on first touch) ---------------- */

let audioCtx = null;
document.addEventListener('pointerdown', () => {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}, { capture: true });

function beep(freq, durMs, when = 0) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime + when;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + durMs / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + durMs / 1000);
}
const tick = (n) => beep(n === 3 ? 440 : n === 2 ? 550 : 660, 120); // 3-2-1 rising ticks
const doneTone = () => { beep(880, 160); beep(1175, 220, 0.18); };
const buzz = (ms) => { if (navigator.vibrate) navigator.vibrate(ms); };

/* ---------------- wake lock ---------------- */

let wakeLock = null;
async function acquireWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/* ---------------- confirm dialog ---------------- */

function confirmAsk(title, body, dangerLabel, onConfirm) {
  $dialogRoot.innerHTML = `
    <div class="dialog-scrim">
      <div class="dialog">
        <h3>${title}</h3>
        <p>${body}</p>
        <div class="row">
          <button class="cancel">Cancel</button>
          <button class="danger">${dangerLabel}</button>
        </div>
      </div>
    </div>`;
  $dialogRoot.querySelector('.cancel').onclick = () => ($dialogRoot.innerHTML = '');
  $dialogRoot.querySelector('.dialog-scrim').onclick = (e) => {
    if (e.target === e.currentTarget) $dialogRoot.innerHTML = '';
  };
  $dialogRoot.querySelector('.danger').onclick = () => {
    $dialogRoot.innerHTML = '';
    onConfirm();
  };
}

/* Stepper dialog for editing a small number (seconds by default). */
function editSecondsDialog(title, sub, initialValue, { step, min, unit = 's' }, onSave) {
  let value = initialValue;
  $dialogRoot.innerHTML = `
    <div class="dialog-scrim">
      <div class="dialog">
        <h3>${title}</h3>
        <p>${sub}</p>
        <div class="stepper">
          <button class="minus">−${step}</button>
          <div class="value"></div>
          <button class="plus">+${step}</button>
        </div>
        <div class="row">
          <button class="cancel">Cancel</button>
          <button class="save">Save</button>
        </div>
      </div>
    </div>`;
  const $value = $dialogRoot.querySelector('.value');
  const draw = () => { $value.textContent = `${value}${unit}`; };
  draw();
  $dialogRoot.querySelector('.minus').onclick = () => { value = Math.max(min, value - step); draw(); };
  $dialogRoot.querySelector('.plus').onclick = () => { value += step; draw(); };
  $dialogRoot.querySelector('.cancel').onclick = () => ($dialogRoot.innerHTML = '');
  $dialogRoot.querySelector('.dialog-scrim').onclick = (e) => {
    if (e.target === e.currentTarget) $dialogRoot.innerHTML = '';
  };
  $dialogRoot.querySelector('.save').onclick = () => {
    $dialogRoot.innerHTML = '';
    onSave(value);
  };
}

/* ---------------- countdown engine (timestamp-based, survives backgrounding) ---------------- */

let countdown = null; // { phases, phaseIdx, endAt, paused, pausedRemaining, onDone, render, lastWhole }

function startCountdown(phases, { render, onDone }) {
  stopCountdown();
  countdown = { phases, phaseIdx: 0, paused: false, render, onDone, lastWhole: null };
  countdown.endAt = Date.now() + phases[0].sec * 1000;
  acquireWakeLock();
  countdown.interval = setInterval(tickCountdown, 200);
  tickCountdown();
}

function tickCountdown() {
  const c = countdown;
  if (!c || c.paused) return;
  const remaining = Math.max(0, Math.ceil((c.endAt - Date.now()) / 1000));
  if (remaining !== c.lastWhole) {
    c.lastWhole = remaining;
    if (remaining >= 1 && remaining <= 3) { tick(remaining); buzz(30); }
    c.render(c.phases[c.phaseIdx], remaining);
  }
  if (remaining <= 0) advancePhase();
}

function advancePhase() {
  const c = countdown;
  doneTone();
  buzz(80);
  if (c.phaseIdx < c.phases.length - 1) {
    c.phaseIdx += 1;
    c.endAt = Date.now() + c.phases[c.phaseIdx].sec * 1000;
    c.lastWhole = null;
  } else {
    const onDone = c.onDone;
    stopCountdown();
    onDone();
  }
}

function stopCountdown() {
  if (countdown?.interval) clearInterval(countdown.interval);
  countdown = null;
  releaseWakeLock();
}

function pauseToggleCountdown() {
  const c = countdown;
  if (!c) return;
  if (c.paused) {
    c.endAt = Date.now() + c.pausedRemaining;
    c.paused = false;
  } else {
    c.pausedRemaining = Math.max(0, c.endAt - Date.now());
    c.paused = true;
  }
}

function adjustCountdown(deltaSec) {
  const c = countdown;
  if (!c) return;
  if (c.paused) c.pausedRemaining = Math.max(0, c.pausedRemaining + deltaSec * 1000);
  else c.endAt = Math.max(Date.now(), c.endAt + deltaSec * 1000);
  c.lastWhole = null;
  tickCountdown();
}

/* ---------------- TIME-set overlay ---------------- */

function runTimedSet(ex, onComplete) {
  const phases = [{ kind: 'prep', label: 'Get ready', sec: 3 }];
  if (ex.per_side) {
    phases.push({ kind: 'work', label: 'First side', sec: ex.durationSec });
    phases.push({ kind: 'prep', label: 'Switch sides', sec: 10 });
    phases.push({ kind: 'work', label: 'Second side', sec: ex.durationSec });
  } else {
    phases.push({ kind: 'work', label: 'Work', sec: ex.durationSec });
  }

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="phase-label"></div>
    <div class="big-time"></div>
    <div class="ex-label">${ex.name}</div>
    <div class="controls">
      <button class="minus">−15</button>
      <button class="pause">Pause</button>
      <button class="plus">+15</button>
    </div>
    <div class="controls">
      <button class="skip">Skip</button>
      <button class="stop">Stop</button>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { stopCountdown(); overlay.remove(); };

  overlay.querySelector('.minus').onclick = () => adjustCountdown(-15);
  overlay.querySelector('.plus').onclick = () => adjustCountdown(15);
  overlay.querySelector('.pause').onclick = (e) => {
    pauseToggleCountdown();
    e.target.textContent = countdown?.paused ? 'Resume' : 'Pause';
  };
  overlay.querySelector('.skip').onclick = () => advancePhase();
  overlay.querySelector('.stop').onclick = close;

  startCountdown(phases, {
    render(phase, remaining) {
      overlay.className = 'overlay ' + phase.kind;
      overlay.querySelector('.phase-label').textContent = phase.label;
      overlay.querySelector('.big-time').textContent = fmtTime(remaining);
    },
    onDone() {
      overlay.remove();
      onComplete();
    },
  });
}

/* ---------------- tabata timer ---------------- */

function loadTabataCfg() {
  const defaults = { workSec: 20, restSec: 10, rounds: 8 };
  try { return { ...defaults, ...(JSON.parse(localStorage.getItem(LS_TABATA)) || {}) }; }
  catch { return defaults; }
}

function renderTimer() {
  const cfg = loadTabataCfg();
  const rows = [
    { key: 'workSec', label: 'Work', step: 5, min: 5, unit: 's' },
    { key: 'restSec', label: 'Rest', step: 5, min: 0, unit: 's' },
    { key: 'rounds', label: 'Rounds', step: 1, min: 1, unit: '×' },
  ];
  const totalMin = () => Math.round((5 + cfg.rounds * cfg.workSec + Math.max(0, cfg.rounds - 1) * cfg.restSec) / 60 * 10) / 10;
  $view.innerHTML = `
    <h1>Tabata</h1>
    <p class="sub">Interval timer — work / rest × rounds. Beeps and buzzes carry you through; no logging.</p>
    ${rows.map((r) => `
      <p class="stepper-label">${r.label}</p>
      <div class="stepper" data-key="${r.key}">
        <button class="minus">−${r.step}</button>
        <div class="value"></div>
        <button class="plus">+${r.step}</button>
      </div>`).join('')}
    <div class="start-bar">
      <button class="btn-primary" id="start-tabata-btn"></button>
    </div>`;
  const paint = () => {
    for (const r of rows)
      $view.querySelector(`.stepper[data-key="${r.key}"] .value`).textContent =
        r.unit === '×' ? `${cfg[r.key]}×` : `${cfg[r.key]}s`;
    $view.querySelector('#start-tabata-btn').textContent = `Start · ~${totalMin()} min`;
  };
  for (const r of rows) {
    const st = $view.querySelector(`.stepper[data-key="${r.key}"]`);
    st.querySelector('.minus').onclick = () => {
      cfg[r.key] = Math.max(r.min, cfg[r.key] - r.step);
      localStorage.setItem(LS_TABATA, JSON.stringify(cfg));
      paint();
    };
    st.querySelector('.plus').onclick = () => {
      cfg[r.key] += r.step;
      localStorage.setItem(LS_TABATA, JSON.stringify(cfg));
      paint();
    };
  }
  paint();
  $view.querySelector('#start-tabata-btn').onclick = () => runTabata(cfg);
}

function runTabata(cfg) {
  const phases = [{ kind: 'prep', label: 'Get ready', sec: 5 }];
  for (let r = 1; r <= cfg.rounds; r++) {
    phases.push({ kind: 'work', label: `Work · round ${r}/${cfg.rounds}`, sec: cfg.workSec });
    if (cfg.restSec > 0 && r < cfg.rounds)
      phases.push({ kind: 'rest', label: `Rest · round ${r}/${cfg.rounds}`, sec: cfg.restSec });
  }

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="phase-label"></div>
    <div class="big-time"></div>
    <div class="ex-label">${cfg.workSec}s on / ${cfg.restSec}s off × ${cfg.rounds}</div>
    <div class="controls">
      <button class="pause">Pause</button>
      <button class="skip">Skip</button>
      <button class="stop">Stop</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('.pause').onclick = (e) => {
    pauseToggleCountdown();
    e.target.textContent = countdown?.paused ? 'Resume' : 'Pause';
  };
  overlay.querySelector('.skip').onclick = () => advancePhase();
  overlay.querySelector('.stop').onclick = () =>
    confirmAsk('Stop tabata?', 'Ends the timer.', 'Stop', () => { stopCountdown(); overlay.remove(); });

  startCountdown(phases, {
    render(phase, remaining) {
      overlay.className = 'overlay ' + phase.kind;
      overlay.querySelector('.phase-label').textContent = phase.label;
      overlay.querySelector('.big-time').textContent = fmtTime(remaining);
    },
    onDone() {
      buzz(300);
      overlay.remove();
    },
  });
}

/* ---------------- rest banner ---------------- */

function startRest(sec, label) {
  $restBanner.classList.remove('hidden');
  $restBanner.innerHTML = `
    <div class="rest-time"></div>
    <div class="rest-label">Rest — next: ${label}</div>
    <button class="minus">−15</button>
    <button class="plus">+15</button>
    <button class="pause">⏸</button>
    <button class="skip">Skip</button>`;
  $restBanner.querySelector('.minus').onclick = () => adjustCountdown(-15);
  $restBanner.querySelector('.plus').onclick = () => adjustCountdown(15);
  $restBanner.querySelector('.pause').onclick = (e) => {
    pauseToggleCountdown();
    e.target.textContent = countdown?.paused ? '▶' : '⏸';
  };
  $restBanner.querySelector('.skip').onclick = hideRest;

  startCountdown([{ kind: 'rest', label: 'Rest', sec }], {
    render(_phase, remaining) {
      const el = $restBanner.querySelector('.rest-time');
      if (el) el.textContent = fmtTime(remaining);
    },
    onDone: hideRest,
  });
}

function hideRest() {
  stopCountdown();
  $restBanner.classList.add('hidden');
  $restBanner.innerHTML = '';
}

/* ---------------- helpers ---------------- */

function fmtTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

// YouTube search-results page for the exercise name — a landing page of options, never one specific video.
function ytSearchLink(name) {
  const href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name);
  return `<a class="yt-link" href="${href}" target="_blank" rel="noopener">▶ video</a>`;
}

function targetText(ex) {
  // Tolerates both shapes: plan exercises (sets count, duration_sec, load_kg, reps)
  // and session exercises (sets array, durationSec, loadKg, targetReps).
  const count = Array.isArray(ex.sets) ? ex.sets.length : ex.sets;
  const side = ex.per_side ? '/side' : '';
  if (ex.metric === 'TIME') return `${count} × ${ex.durationSec ?? ex.duration_sec}s${side}`;
  const loadVal = ex.loadKg ?? ex.load_kg;
  const load = ex.metric === 'REPS_LOAD' && loadVal ? ` @ ${loadVal} kg` : '';
  return `${count} × ${ex.targetReps ?? ex.reps}${side}${load}`;
}

// All done sets from the most recent session containing this exercise, newest-first scan.
function lastLoggedSets(exId) {
  const history = loadHistory();
  for (let i = history.length - 1; i >= 0; i--) {
    for (const b of history[i].blocks) {
      for (const ex of b.exercises) {
        if (ex.id !== exId) continue;
        const doneSets = ex.sets.filter((s) => s.done);
        if (doneSets.length) return doneSets;
      }
    }
  }
  return null;
}

// Last logged load/reps for an exercise (final set of its most recent session).
function lastLogged(exId) {
  const sets = lastLoggedSets(exId);
  return sets ? sets[sets.length - 1] : null;
}

/* ---------------- session lifecycle ---------------- */

function startSession() {
  const overrides = loadOverrides();
  const blocks = allBlocks()
    .filter((b) => selectedBlockIds.includes(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      exercises: b.exercises.map((ex) => {
        const last = lastLogged(ex.id);
        const ov = overrides[ex.id] || {};
        return {
          id: ex.id,
          name: ex.name,
          metric: ex.metric,
          per_side: !!ex.per_side,
          restSec: ov.restSec ?? ex.rest_sec,
          cue: ex.cue,
          targetReps: ex.reps ?? null,
          durationSec: ov.durationSec ?? ex.duration_sec ?? null,
          loadKg: last?.load ?? ex.load_kg ?? null,
          sets: Array.from({ length: ov.sets ?? ex.sets }, () => ({
            done: false,
            reps: null,
            load: last?.load ?? ex.load_kg ?? null,
          })),
        };
      }),
    }));
  saveActive({ startedAt: new Date().toISOString(), blocks });
  selectedBlockIds = [];
  render();
}

function finishSession() {
  const session = loadActive();
  session.finishedAt = new Date().toISOString();
  const history = loadHistory();
  history.push(session);
  saveHistory(history);
  saveActive(null);
  hideRest();
  selectedBlockIds = todaysPlannedBlockIds();
  render();
}

function discardSession() {
  saveActive(null);
  hideRest();
  selectedBlockIds = todaysPlannedBlockIds();
  render();
}

/* ---------------- render: train tab ---------------- */

const expandedBlocks = new Set();

function renderPicker() {
  const total = allBlocks()
    .filter((b) => selectedBlockIds.includes(b.id))
    .reduce((sum, b) => sum + b.duration_min, 0);

  const plannedToday = todaysPlannedBlockIds();
  $view.innerHTML = `
    <h1>Today</h1>
    <p class="sub">${plannedToday.length
      ? `Pre-filled from your weekly plan (${DAY_NAMES[todayKey()]}) — adjust freely.`
      : 'Pick your blocks, then start.'}</p>
    <div id="block-list"></div>
    <button class="block-card create" id="create-block-btn">＋ Create your own block</button>
    <div class="start-bar">
      <button class="btn-primary" id="start-btn" ${selectedBlockIds.length ? '' : 'disabled'}>
        ${selectedBlockIds.length ? `Start session · ~${total} min` : 'Select at least one block'}
      </button>
    </div>`;

  const list = $view.querySelector('#block-list');
  for (const b of visibleBlocks()) {
    const selected = selectedBlockIds.includes(b.id);
    const expanded = expandedBlocks.has(b.id);
    const card = document.createElement('div');
    card.className = 'block-card' + (selected ? ' selected' : '');
    card.innerHTML = `
      <span class="tick">${selected ? '✓' : ''}</span>
      <span class="meta">
        <span class="name">${b.name}</span><br>
        <span class="detail">~${b.duration_min} min · ${b.exercises.length} exercises</span>
      </span>
      <button class="icon-btn edit">✎</button>
      <button class="icon-btn expand">${expanded ? '▾' : '▸'}</button>`;

    card.onclick = () => {
      selectedBlockIds = selected
        ? selectedBlockIds.filter((id) => id !== b.id)
        : [...selectedBlockIds, b.id];
      render();
    };
    card.querySelector('.expand').onclick = (e) => {
      e.stopPropagation();
      expanded ? expandedBlocks.delete(b.id) : expandedBlocks.add(b.id);
      render();
    };
    card.querySelector('.edit').onclick = (e) => {
      e.stopPropagation();
      editingBlock = { id: b.id, name: b.name, exercises: JSON.parse(JSON.stringify(b.exercises)) };
      render();
    };
    list.appendChild(card);

    if (expanded) {
      const detail = document.createElement('div');
      detail.className = 'block-detail';
      detail.innerHTML = b.exercises
        .map((ex) => `<div class="detail-line"><b>${ex.name}</b> — ${targetText(ex)} ${ytSearchLink(ex.name)}</div>`)
        .join('');
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-ghost detail-hide danger';
      delBtn.textContent = 'Delete this block';
      delBtn.onclick = () => {
        confirmAsk('Delete block?', 'Removes it from the picker and your weekly plan. Logged history is kept.', 'Delete', () => {
          deleteBlock(b.id);
          expandedBlocks.delete(b.id);
          render();
        });
      };
      detail.appendChild(delBtn);
      list.appendChild(detail);
    }
  }

  // Deleted standard blocks are gone from the list entirely; one button brings them all back.
  const deletedDefaults = loadHidden().filter((id) => isBundledId(id));
  if (deletedDefaults.length) {
    const restore = document.createElement('button');
    restore.className = 'btn-ghost restore-defaults';
    restore.textContent = `Restore standard blocks (${deletedDefaults.length})`;
    restore.onclick = () => { saveHidden([]); render(); };
    list.appendChild(restore);
  }

  $view.querySelector('#create-block-btn').onclick = () => {
    editingBlock = { id: null, name: '', exercises: [] };
    render();
  };
  $view.querySelector('#start-btn').onclick = () => {
    if (selectedBlockIds.length) startSession();
  };
}

/* ---------------- custom block editor ---------------- */

let editingBlock = null; // { id: string|null, name, exercises: [...] }

function renderBlockEditor() {
  const eb = editingBlock;
  const chosen = new Set(eb.exercises.map((ex) => ex.id));
  const estMin = eb.exercises.length ? estimateDurationMin(eb.exercises) : 0;
  const bundled = eb.id && isBundledId(eb.id);
  const hasShadow = eb.id && loadCustomBlocks().some((b) => b.id === eb.id);

  $view.innerHTML = `
    <div class="session-head">
      <h1>${eb.id ? 'Edit block' : 'New block'}</h1>
      <div>
        ${bundled && hasShadow ? '<button class="btn-ghost" id="revert-block-btn">Revert</button>' : ''}
        ${eb.id ? '<button class="btn-ghost danger" id="delete-block-btn">Delete</button>' : ''}
        <button class="btn-ghost" id="cancel-edit-btn">Cancel</button>
      </div>
    </div>
    ${bundled ? `<p class="sub">Standard block — saving stores your personal version${hasShadow ? '; Revert restores the original' : ''}. Deleted standard blocks come back via “Restore standard blocks” in the picker.</p>` : ''}
    <input class="name-input" id="block-name" type="text" placeholder="Block name (e.g. My Core)" value="${eb.name.replace(/"/g, '&quot;')}">
    <p class="sub">Tap exercises to add them — tapping order = block order.</p>
    <div id="lib-list"></div>
    <div class="start-bar">
      <button class="btn-primary" id="save-block-btn" ${eb.name.trim() && eb.exercises.length ? '' : 'disabled'}>
        ${eb.exercises.length ? `Save block · ${eb.exercises.length} exercises · ~${estMin} min` : 'Pick at least one exercise'}
      </button>
    </div>`;

  const nameInput = $view.querySelector('#block-name');
  nameInput.oninput = () => {
    eb.name = nameInput.value;
    $view.querySelector('#save-block-btn').toggleAttribute('disabled', !(eb.name.trim() && eb.exercises.length));
  };

  const libList = $view.querySelector('#lib-list');
  libList.insertAdjacentHTML('beforeend', '<button class="block-card new-exercise" id="new-exercise-btn"><span class="tick">＋</span><span class="meta"><span class="name">New exercise</span><br><span class="detail">Add your own to the library</span></span></button>');
  libList.querySelector('#new-exercise-btn').onclick = () => {
    editingExercise = {
      id: null, name: '', category: Object.keys(schedule.categories || {})[0] || 'pull',
      metric: 'REPS', sets: 3, reps: '8', duration_sec: 30, load_kg: 0, rest_sec: 60,
      per_side: false, cue: '',
    };
    render();
  };
  const lib = libraryExercises();
  for (const [catKey, catName] of Object.entries(schedule.categories || {})) {
    const items = lib.filter((ex) => ex.category === catKey);
    if (!items.length) continue;
    libList.insertAdjacentHTML('beforeend', `<h2>${catName}</h2>`);
    for (const ex of items) {
      const isChosen = chosen.has(ex.id);
      const row = document.createElement(ex.custom ? 'div' : 'button');
      row.className = 'block-card' + (isChosen ? ' selected' : '');
      row.innerHTML = `
        <span class="tick">${isChosen ? '✓' : ''}</span>
        <span class="meta">
          <span class="name">${ex.name}</span><br>
          <span class="detail">${targetText(ex)}${ex.cue ? ' · ' + ex.cue : ''}</span>
        </span>
        ${ex.custom ? '<button class="icon-btn edit-ex">✎</button>' : ''}`;
      row.onclick = () => {
        if (isChosen) eb.exercises = eb.exercises.filter((e) => e.id !== ex.id);
        else eb.exercises.push(JSON.parse(JSON.stringify(ex)));
        render();
      };
      if (ex.custom) {
        row.querySelector('.edit-ex').onclick = (e) => {
          e.stopPropagation();
          editingExercise = JSON.parse(JSON.stringify(ex));
          render();
        };
      }
      libList.appendChild(row);
    }
  }
  $view.querySelector('#cancel-edit-btn').onclick = () => { editingBlock = null; render(); };
  if (eb.id) {
    $view.querySelector('#delete-block-btn').onclick = () =>
      confirmAsk('Delete block?', 'Removes it from the picker and your weekly plan. Logged history is kept.', 'Delete', () => {
        deleteBlock(eb.id);
        editingBlock = null;
        render();
      });
  }
  if (bundled && hasShadow) {
    // Restores the bundled original; the block stays in plans and the picker.
    $view.querySelector('#revert-block-btn').onclick = () =>
      confirmAsk('Revert block?', 'Discards your personal version and restores the built-in one.', 'Revert', () => {
        saveCustomBlocks(loadCustomBlocks().filter((b) => b.id !== eb.id));
        editingBlock = null;
        render();
      });
  }
  $view.querySelector('#save-block-btn').onclick = () => {
    if (!eb.name.trim() || !eb.exercises.length) return;
    const blocks = loadCustomBlocks();
    const block = {
      id: eb.id || 'custom_' + Date.now(),
      name: eb.name.trim(),
      duration_min: estimateDurationMin(eb.exercises),
      custom: true,
      exercises: eb.exercises,
    };
    const idx = blocks.findIndex((b) => b.id === block.id);
    if (idx >= 0) blocks[idx] = block;
    else blocks.push(block);
    saveCustomBlocks(blocks);
    editingBlock = null;
    render();
  };
}

/* ---------------- custom exercise form ---------------- */

let editingExercise = null; // null | draft exercise object (id null until first save)

function exerciseDraftValid(ex) {
  if (!ex.name.trim()) return false;
  return ex.metric === 'TIME' ? +ex.duration_sec > 0 : String(ex.reps).trim().length > 0;
}

function renderExerciseForm() {
  const ex = editingExercise;
  const cats = Object.entries(schedule.categories || {});
  const metrics = [['REPS', 'Reps'], ['REPS_LOAD', 'Reps + kg'], ['TIME', 'Seconds']];
  const existing = ex.id && loadCustomExercises().some((e) => e.id === ex.id);

  $view.innerHTML = `
    <div class="session-head">
      <h1>${existing ? 'Edit exercise' : 'New exercise'}</h1>
      <div>
        ${existing ? '<button class="btn-ghost danger" id="delete-ex-btn">Delete</button>' : ''}
        <button class="btn-ghost" id="cancel-ex-btn">Cancel</button>
      </div>
    </div>
    <input class="name-input" id="ex-name" type="text" placeholder="Exercise name" value="${ex.name.replace(/"/g, '&quot;')}">
    <p class="sub">Category</p>
    <div class="chip-row wrap form-chips" id="ex-cat">${cats.map(([k, label]) => `<button class="chip ${ex.category === k ? 'selected' : ''}" data-cat="${k}">${label}</button>`).join('')}</div>
    <p class="sub">Measured in</p>
    <div class="chip-row form-chips" id="ex-metric">${metrics.map(([k, label]) => `<button class="chip ${ex.metric === k ? 'selected' : ''}" data-metric="${k}">${label}</button>`).join('')}</div>
    <div class="form-grid">
      <label>Sets<input id="ex-sets" type="number" min="1" inputmode="numeric" value="${ex.sets}"></label>
      ${ex.metric === 'TIME'
        ? '<label>Seconds<input id="ex-secs" type="number" min="5" step="5" inputmode="numeric" value="' + ex.duration_sec + '"></label>'
        : '<label>Reps<input id="ex-reps" type="text" inputmode="numeric" placeholder="8 or 6-10" value="' + String(ex.reps).replace(/"/g, '&quot;') + '"></label>'}
      ${ex.metric === 'REPS_LOAD' ? '<label>kg<input id="ex-load" type="number" min="0" step="0.5" inputmode="decimal" value="' + (ex.load_kg || 0) + '"></label>' : ''}
      <label>Rest (s)<input id="ex-rest" type="number" min="0" step="15" inputmode="numeric" value="${ex.rest_sec}"></label>
    </div>
    <button class="chip form-chips ${ex.per_side ? 'selected' : ''}" id="ex-per-side">Per side</button>
    <input class="name-input" id="ex-cue" type="text" placeholder="Cue (optional) — e.g. slow on the way down" value="${(ex.cue || '').replace(/"/g, '&quot;')}">
    <div class="start-bar">
      <button class="btn-primary" id="save-ex-btn" ${exerciseDraftValid(ex) ? '' : 'disabled'}>Save exercise</button>
    </div>`;

  const refreshSave = () =>
    $view.querySelector('#save-ex-btn').toggleAttribute('disabled', !exerciseDraftValid(ex));
  const bind = (id, apply) => {
    const el = $view.querySelector(id);
    if (el) el.oninput = () => { apply(el.value); refreshSave(); };
  };
  bind('#ex-name', (v) => { ex.name = v; });
  bind('#ex-sets', (v) => { ex.sets = v; });
  bind('#ex-secs', (v) => { ex.duration_sec = v; });
  bind('#ex-reps', (v) => { ex.reps = v; });
  bind('#ex-load', (v) => { ex.load_kg = v; });
  bind('#ex-rest', (v) => { ex.rest_sec = v; });
  bind('#ex-cue', (v) => { ex.cue = v; });
  for (const chip of $view.querySelectorAll('#ex-cat .chip'))
    chip.onclick = () => { ex.category = chip.dataset.cat; render(); };
  for (const chip of $view.querySelectorAll('#ex-metric .chip'))
    chip.onclick = () => { ex.metric = chip.dataset.metric; render(); };
  $view.querySelector('#ex-per-side').onclick = () => { ex.per_side = !ex.per_side; render(); };

  $view.querySelector('#cancel-ex-btn').onclick = () => { editingExercise = null; render(); };
  if (existing) {
    $view.querySelector('#delete-ex-btn').onclick = () =>
      confirmAsk('Delete exercise?', 'Removes it from your library. Blocks that already include it keep their copy.', 'Delete', () => {
        saveCustomExercises(loadCustomExercises().filter((e) => e.id !== ex.id));
        editingExercise = null;
        render();
      });
  }
  $view.querySelector('#save-ex-btn').onclick = () => {
    if (!exerciseDraftValid(ex)) return;
    const clean = {
      id: ex.id || 'custom_ex_' + Date.now(),
      name: ex.name.trim(),
      category: ex.category,
      metric: ex.metric,
      sets: Math.max(1, parseInt(ex.sets, 10) || 1),
      rest_sec: Math.max(0, parseInt(ex.rest_sec, 10) || 0),
      cue: (ex.cue || '').trim(),
      custom: true,
    };
    if (ex.metric === 'TIME') clean.duration_sec = Math.max(5, parseInt(ex.duration_sec, 10) || 30);
    else clean.reps = String(ex.reps).trim();
    if (ex.metric === 'REPS_LOAD') clean.load_kg = Math.max(0, parseFloat(ex.load_kg) || 0);
    if (ex.per_side) clean.per_side = true;
    const list = loadCustomExercises();
    const idx = list.findIndex((e) => e.id === clean.id);
    if (idx >= 0) list[idx] = clean;
    else list.push(clean);
    saveCustomExercises(list);
    editingExercise = null;
    render();
  };
}

function renderSession(session) {
  $view.innerHTML = `
    <div class="session-head">
      <h1>Session</h1>
      <div>
        <button class="btn-ghost danger" id="discard-btn">Discard</button>
        <button class="btn-ghost" id="finish-btn">Finish</button>
      </div>
    </div>`;

  session.blocks.forEach((block, bi) => {
    const section = document.createElement('div');
    section.className = 'block-section';
    section.innerHTML = `<div class="block-title">${block.name}</div>`;

    block.exercises.forEach((ex, ei) => {
      const card = document.createElement('div');
      card.className = 'ex-card';
      card.innerHTML = `
        <div class="ex-name">${ex.name} ${ytSearchLink(ex.name)}</div>
        <div class="ex-target">${targetText(ex)}</div>
        <div class="ex-cue">${ex.cue}</div>`;

      const lastSets = lastLoggedSets(ex.id);

      // Tappable timer chips — edits persist for future sessions (per-exercise override).
      const chips = document.createElement('div');
      chips.className = 'chip-row wrap';

      const setsChip = document.createElement('button');
      setsChip.className = 'chip';
      setsChip.innerHTML = `<span class="chip-label">sets</span>${ex.sets.length} ✎`;
      setsChip.onclick = () =>
        editSecondsDialog(ex.name, 'Number of sets. Saved for future sessions too.', ex.sets.length, { step: 1, min: 1, unit: '' }, (v) => {
          const doneCount = ex.sets.filter((s) => s.done).length;
          const target = Math.max(v, doneCount, 1); // never delete already-completed sets
          while (ex.sets.length < target) ex.sets.push({ done: false, reps: null, load: ex.loadKg ?? null });
          while (ex.sets.length > target && !ex.sets[ex.sets.length - 1].done) ex.sets.pop();
          saveActive(session);
          saveOverride(ex.id, { sets: target });
          render();
        });
      chips.appendChild(setsChip);

      // One-tap paste of last session's numbers (REPS / REPS_LOAD only).
      if (lastSets && ex.metric !== 'TIME') {
        const repsList = lastSets.map((s) => s.reps ?? '?').join(', ');
        const lastLoad = lastSets[lastSets.length - 1].load;
        const loadText = ex.metric === 'REPS_LOAD' && lastLoad ? ` @ ${lastLoad} kg` : '';
        const pasteChip = document.createElement('button');
        pasteChip.className = 'chip paste';
        pasteChip.innerHTML = `<span class="chip-label">↻ last</span>${repsList}${loadText}`;
        pasteChip.onclick = () => {
          ex.sets.forEach((set, i) => {
            if (set.done) return;
            const src = lastSets[Math.min(i, lastSets.length - 1)];
            set.reps = src.reps ?? set.reps;
            if (ex.metric === 'REPS_LOAD') set.load = src.load ?? set.load;
          });
          saveActive(session);
          render();
        };
        chips.appendChild(pasteChip);
      }
      if (ex.metric === 'TIME') {
        const workChip = document.createElement('button');
        workChip.className = 'chip';
        workChip.innerHTML = `<span class="chip-label">work</span>${ex.durationSec}s ✎`;
        workChip.onclick = () =>
          editSecondsDialog(ex.name, 'Work duration per set. Saved for future sessions too.', ex.durationSec, { step: 5, min: 5 }, (v) => {
            ex.durationSec = v;
            saveActive(session);
            saveOverride(ex.id, { durationSec: v });
            render();
          });
        chips.appendChild(workChip);
      }
      if (ex.restSec) {
        const restChip = document.createElement('button');
        restChip.className = 'chip';
        restChip.innerHTML = `<span class="chip-label">rest</span>${ex.restSec}s ✎`;
        restChip.onclick = () =>
          editSecondsDialog(ex.name, 'Rest between sets. Saved for future sessions too.', ex.restSec, { step: 15, min: 15 }, (v) => {
            ex.restSec = v;
            saveActive(session);
            saveOverride(ex.id, { restSec: v });
            render();
          });
        chips.appendChild(restChip);
      }
      card.appendChild(chips);

      ex.sets.forEach((set, si) => {
        const row = document.createElement('div');
        row.className = 'set-row';
        row.innerHTML = `<span class="set-label">Set ${si + 1}</span>`;

        if (ex.metric === 'TIME') {
          const btn = document.createElement('button');
          btn.className = 'set-done-btn' + (set.done ? ' done' : '');
          btn.textContent = '✓';
          btn.onclick = () => toggleSetDone(bi, ei, si);
          const timerBtn = document.createElement('button');
          timerBtn.className = 'timer-btn';
          timerBtn.textContent = `▶ ${ex.durationSec}s`;
          timerBtn.onclick = () => {
            hideRest();
            runTimedSet(ex, () => markTimedSetDone(bi, ei, si));
          };
          row.appendChild(btn);
          row.appendChild(timerBtn);
        } else {
          const repsInput = document.createElement('input');
          repsInput.type = 'number';
          repsInput.inputMode = 'numeric';
          repsInput.placeholder = lastSets?.[si]?.reps ?? ex.targetReps;
          if (set.reps != null) repsInput.value = set.reps;
          repsInput.onchange = () => {
            set.reps = repsInput.value === '' ? null : Number(repsInput.value);
            saveActive(session);
          };
          row.appendChild(repsInput);
          row.insertAdjacentHTML('beforeend', '<span class="unit">reps</span>');

          if (ex.metric === 'REPS_LOAD') {
            const loadInput = document.createElement('input');
            loadInput.type = 'number';
            loadInput.inputMode = 'decimal';
            loadInput.step = '0.5';
            if (set.load != null) loadInput.value = set.load;
            loadInput.onchange = () => {
              set.load = loadInput.value === '' ? null : Number(loadInput.value);
              saveActive(session);
            };
            row.appendChild(loadInput);
            row.insertAdjacentHTML('beforeend', '<span class="unit">kg</span>');
          }

          const btn = document.createElement('button');
          btn.className = 'set-done-btn' + (set.done ? ' done' : '');
          btn.textContent = '✓';
          btn.onclick = () => toggleSetDone(bi, ei, si);
          row.appendChild(btn);
        }
        card.appendChild(row);
      });

      section.appendChild(card);
    });
    $view.appendChild(section);
  });

  $view.querySelector('#discard-btn').onclick = () =>
    confirmAsk('Discard session?', 'Deletes everything logged in this session.', 'Discard', discardSession);
  $view.querySelector('#finish-btn').onclick = () =>
    confirmAsk('Finish session?', 'Saves the session to history.', 'Finish', finishSession);
}

function toggleSetDone(bi, ei, si) {
  const session = loadActive();
  const ex = session.blocks[bi].exercises[ei];
  const set = ex.sets[si];
  set.done = !set.done;
  if (set.done && set.reps == null && ex.targetReps && !ex.targetReps.includes('-')) {
    set.reps = Number(ex.targetReps); // simple targets autofill; ranges stay manual
  }
  saveActive(session);
  render();
  if (set.done && ex.restSec) {
    const isLastSet = si === ex.sets.length - 1;
    startRest(ex.restSec, isLastSet ? 'next exercise' : `${ex.name} set ${si + 2}`);
  }
}

function markTimedSetDone(bi, ei, si) {
  const session = loadActive();
  const ex = session.blocks[bi].exercises[ei];
  ex.sets[si].done = true;
  saveActive(session);
  render();
  if (ex.restSec && si < ex.sets.length - 1) startRest(ex.restSec, `${ex.name} set ${si + 2}`);
}

/* ---------------- render: week tab ---------------- */

let viewWeekOffset = 0; // 0 = this week, 1 = next week
let expandedDay = null; // "<wkKey>:<day>" whose add-blocks row is open

function renderWeek() {
  const start = weekStart(viewWeekOffset);
  const wkKey = isoWeekKey(start);
  const plans = loadWeekPlans();
  const plan = plans[wkKey] || {};
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmtShort = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const todayStr = new Date().toDateString();

  $view.innerHTML = `
    <h1>Weekly plan</h1>
    <div class="chip-row">
      <button class="chip ${viewWeekOffset === 0 ? 'selected' : ''}" id="wk-this">This week</button>
      <button class="chip ${viewWeekOffset === 1 ? 'selected' : ''}" id="wk-next">Next week</button>
    </div>
    <p class="sub">${fmtShort(start)} – ${fmtShort(end)} · plan each day; the picker pre-fills from this on the day.</p>
    <div id="copy-slot"></div>`;

  $view.querySelector('#wk-this').onclick = () => { viewWeekOffset = 0; render(); };
  $view.querySelector('#wk-next').onclick = () => { viewWeekOffset = 1; render(); };

  // Empty week + previous week has content → offer one-tap copy.
  const prevPlan = plans[isoWeekKey(new Date(start.getTime() - 7 * 86400000))];
  const isEmpty = !DAY_KEYS.some((d) => (plan[d] || []).length);
  const prevHasContent = prevPlan && DAY_KEYS.some((d) => (prevPlan[d] || []).length);
  if (isEmpty && prevHasContent) {
    const btn = document.createElement('button');
    btn.className = 'block-card create';
    btn.textContent = '⧉ Copy last week’s plan';
    btn.onclick = () => {
      const p = loadWeekPlans();
      p[wkKey] = JSON.parse(JSON.stringify(prevPlan));
      saveWeekPlans(p);
      if (!loadActive()) selectedBlockIds = todaysPlannedBlockIds();
      render();
    };
    $view.querySelector('#copy-slot').appendChild(btn);
  }

  DAY_KEYS.forEach((day, i) => {
    const date = new Date(start.getTime() + i * 86400000);
    const isToday = date.toDateString() === todayStr;
    const isPast = !isToday && date < new Date();
    const planned = plan[day] || [];
    const totalMin = allBlocks()
      .filter((b) => planned.includes(b.id))
      .reduce((sum, b) => sum + b.duration_min, 0);

    const dayKey = `${wkKey}:${day}`;
    const mutatePlan = (fn) => {
      const p = loadWeekPlans();
      const week = p[wkKey] || (p[wkKey] = {});
      week[day] = fn(week[day] || []);
      saveWeekPlans(p);
      if (isToday && !loadActive()) selectedBlockIds = todaysPlannedBlockIds();
      render();
    };

    const row = document.createElement('div');
    row.className = 'day-row' + (isToday ? ' today' : '') + (isPast ? ' past' : '');
    row.innerHTML = `
      <div class="day-head">
        <span class="day-name">${DAY_NAMES[day]} · ${fmtShort(date)}${isToday ? ' · today' : ''}</span>
        <span class="day-total">${totalMin ? `~${totalMin} min` : 'rest'}</span>
      </div>
      <div class="chip-row wrap planned"></div>`;

    // Planned blocks only — tap a chip to remove it from the day.
    const plannedRow = row.querySelector('.chip-row');
    for (const id of planned) {
      const b = visibleBlocks().find((x) => x.id === id);
      if (!b) continue;
      const chip = document.createElement('button');
      chip.className = 'chip selected';
      chip.textContent = b.name + ' ✕';
      chip.onclick = () => mutatePlan((cur) => cur.filter((x) => x !== id));
      plannedRow.appendChild(chip);
    }

    // ＋ opens this day's add-list; every other day stays compact.
    const addChip = document.createElement('button');
    addChip.className = 'chip add';
    addChip.textContent = expandedDay === dayKey ? '－ close' : '＋ add';
    addChip.onclick = () => {
      expandedDay = expandedDay === dayKey ? null : dayKey;
      render();
    };
    plannedRow.appendChild(addChip);

    if (expandedDay === dayKey) {
      const addRow = document.createElement('div');
      addRow.className = 'chip-row wrap add-row';
      const candidates = visibleBlocks().filter((b) => !planned.includes(b.id));
      if (!candidates.length) {
        addRow.innerHTML = '<span class="sub" style="margin:0">All blocks already planned.</span>';
      }
      for (const b of candidates) {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = `${b.name} · ${b.duration_min}m`;
        chip.onclick = () => mutatePlan((cur) => [...cur, b.id]);
        addRow.appendChild(chip);
      }
      row.appendChild(addRow);
    }
    $view.appendChild(row);
  });
}

/* ---------------- render: history tab ---------------- */

const expandedHist = new Set();

function renderHistory() {
  const history = loadHistory();
  $view.innerHTML = `
    <div class="session-head">
      <h1>History</h1>
      <button class="btn-ghost" id="export-btn">Export</button>
    </div>`;

  if (!history.length) {
    $view.insertAdjacentHTML('beforeend', '<p class="empty">No sessions yet. Go climb something.</p>');
  }

  [...history].reverse().forEach((session, revIdx) => {
    const idx = history.length - 1 - revIdx;
    const doneSets = session.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets)).filter((s) => s.done).length;
    const card = document.createElement('button');
    card.className = 'hist-card';
    card.innerHTML = `
      <div class="hist-date">${fmtDate(session.startedAt)}</div>
      <div class="hist-detail">${session.blocks.map((b) => b.name).join(' + ')} · ${doneSets} sets</div>`;

    if (expandedHist.has(idx)) {
      const details = document.createElement('div');
      details.className = 'hist-sets';
      for (const b of session.blocks) {
        for (const ex of b.exercises) {
          const sets = ex.sets.filter((s) => s.done);
          if (!sets.length) continue;
          const parts = sets.map((s) => {
            if (ex.metric === 'TIME') return `${ex.durationSec}s`;
            const load = s.load != null && s.load !== 0 ? `@${s.load}kg` : '';
            return `${s.reps ?? '?'}${load}`;
          });
          details.insertAdjacentHTML('beforeend', `<div class="ex-line"><b>${ex.name}</b> — ${parts.join(', ')}</div>`);
        }
      }
      card.appendChild(details);
    }

    card.onclick = () => {
      expandedHist.has(idx) ? expandedHist.delete(idx) : expandedHist.add(idx);
      render();
    };
    $view.appendChild(card);
  });

  $view.querySelector('#export-btn').onclick = exportHistory;
}

async function exportHistory() {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), history: loadHistory() }, null, 2);
  const file = new File([payload], 'climbing-history.json', { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Climbing history' }); return; } catch {}
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'climbing-history.json';
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------- root render + boot ---------------- */

function render() {
  if (currentTab === 'history') {
    renderHistory();
    return;
  }
  if (currentTab === 'week') {
    renderWeek();
    return;
  }
  if (currentTab === 'timer') {
    renderTimer();
    return;
  }
  if (editingExercise) {
    renderExerciseForm();
    return;
  }
  if (editingBlock) {
    renderBlockEditor();
    return;
  }
  const session = loadActive();
  if (session) renderSession(session);
  else renderPicker();
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.onclick = () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
    render();
  };
});

fetch('schedule.json')
  .then((r) => r.json())
  .then((data) => {
    schedule = data;
    migrateLegacyTemplate();
    if (!loadActive()) selectedBlockIds = todaysPlannedBlockIds(); // seed picker from this week's plan
    render();
  })
  .catch(() => {
    $view.innerHTML = '<p class="empty">Could not load the training plan. Open once with internet.</p>';
  });
