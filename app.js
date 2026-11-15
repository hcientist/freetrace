// FreeTrace — position a reference image, lock the screen, trace on paper.
const $ = (s) => document.querySelector(s);

const stage = $('#stage');
const wrap = $('#refwrap');
const img = $('#ref');
const canvas = $('#draw');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------- storage
const idb = (() => {
  let p;
  const open = () =>
    (p ??= new Promise((res, rej) => {
      const r = indexedDB.open('freetrace', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)).catch((e) => console.warn('idb', e)),
    del: (k) => tx('readwrite', (s) => s.delete(k)).catch(() => {}),
  };
})();

const LS_KEY = 'freetrace:state';
const defaults = {
  tx: innerWidth / 2, ty: innerHeight / 2, s: 1, r: 0, fx: 1, fy: 1,
  opacity: 1, gray: false, showImage: true,
  mode: 'move', tool: 'pen', color: '#111111', size: 4, pencilOnly: false,
  src: null, // {kind:'blob'} | {kind:'url', url}
  barHidden: false,
};
const state = { ...defaults };
try { Object.assign(state, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch {}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
  }, 250);
}

// ---------------------------------------------------------------- feedback
let hudTimer, toastTimer;
function hud(text) {
  const el = $('#hud');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => el.classList.remove('show'), 900);
}
function toast(text, ms = 2600) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const deg = (r) => {
  let d = Math.round((r * 180) / Math.PI) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
};
const showTransformHud = () => hud(`${Math.round(state.s * 100)}%  ·  ${deg(state.r)}°`);

// ---------------------------------------------------------------- image
function render() {
  wrap.style.transform =
    `translate(${state.tx}px, ${state.ty}px) rotate(${state.r}rad) scale(${state.s * state.fx}, ${state.s * state.fy})`;
  img.style.opacity = state.opacity;
  img.style.filter = state.gray ? 'grayscale(1)' : '';
  wrap.style.visibility = state.showImage ? '' : 'hidden';
}

function setImgSrc(src, cors) {
  return new Promise((res, rej) => {
    const probe = new Image();
    if (cors) probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      if (cors) img.crossOrigin = 'anonymous'; else img.removeAttribute('crossorigin');
      img.src = src;
      img.dataset.tainted = cors ? '' : '1';
      (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(res);
    };
    probe.onerror = () => rej(new Error('That image could not be loaded.'));
    probe.src = src;
  });
}

let objectUrl;
async function loadBlob(blob, { fit = true, persist = true } = {}) {
  if (!blob.type.startsWith('image/') && blob.type) throw new Error('That file is not an image.');
  const url = URL.createObjectURL(blob);
  await setImgSrc(url, true);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = url;
  if (persist) {
    state.src = { kind: 'blob' };
    await idb.set('image', blob);
  }
  if (fit) fitImage();
  closePicker();
  render();
  save();
}

async function loadUrl(raw, { fit = true } = {}) {
  const url = new URL(raw, location.href).href;
  // Prefer fetching (CORS-friendly hosts) so the image is saved offline and exportable.
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error(r.status);
    const blob = await r.blob();
    if (blob.type && !blob.type.startsWith('image/')) throw new Error('not image');
    await loadBlob(blob, { fit });
    return;
  } catch {}
  await setImgSrc(url, false);
  state.src = { kind: 'url', url };
  idb.del('image');
  if (fit) fitImage();
  closePicker();
  render();
  save();
}

function fitImage() {
  const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
  const quarter = Math.abs(Math.round(state.r / (Math.PI / 2))) % 2 === 1;
  const [w, h] = quarter ? [ih, iw] : [iw, ih];
  state.s = Math.min(innerWidth / w, innerHeight / h);
  state.tx = innerWidth / 2;
  state.ty = innerHeight / 2;
  render();
  save();
}

// ---------------------------------------------------------------- picker
const picker = $('#picker');
function openPicker(empty = false) {
  $('#pickerError').hidden = true;
  picker.classList.toggle('empty', empty);
  $('#pickerClose').hidden = empty;
  picker.hidden = false;
}
function closePicker() { picker.hidden = true; }
function pickerError(e) {
  const el = $('#pickerError');
  el.textContent = e?.message || String(e);
  el.hidden = false;
  if (picker.hidden) toast(el.textContent);
}

$('#file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) loadBlob(f).catch(pickerError);
});
$('#urlform').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#url').value.trim();
  if (v) loadUrl(v).catch(pickerError);
});
$('#pickerClose').addEventListener('click', closePicker);
$('#btnImage').addEventListener('click', () => openPicker(false));

addEventListener('paste', (e) => {
  if (locked) return;
  const items = [...(e.clipboardData?.items || [])];
  const file = items.find((i) => i.type.startsWith('image/'))?.getAsFile();
  if (file) { e.preventDefault(); loadBlob(file).catch(pickerError); return; }
  const text = e.clipboardData?.getData('text')?.trim();
  if (text && /^(https?:|data:image\/)/i.test(text) && document.activeElement?.id !== 'url') {
    e.preventDefault();
    loadUrl(text).catch(pickerError);
  }
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  if (locked) return;
  const f = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (f) return loadBlob(f).catch(pickerError);
  const u = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
  if (u) loadUrl(u.split('\n')[0].trim()).catch(pickerError);
});

// ---------------------------------------------------------------- move gestures
const pointers = new Map();

function applyGesture(mOld, mNew, k, dr) {
  const dx = state.tx - mOld.x, dy = state.ty - mOld.y;
  const c = Math.cos(dr), s = Math.sin(dr);
  state.tx = mNew.x + k * (c * dx - s * dy);
  state.ty = mNew.y + k * (s * dx + c * dy);
  state.s = Math.min(Math.max(state.s * k, 0.01), 100);
  state.r += dr;
  render();
}

stage.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'move' || locked) return;
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
stage.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const now = { x: e.clientX, y: e.clientY };
  const ids = [...pointers.keys()];
  if (ids.length === 1) {
    pointers.set(e.pointerId, now);
    state.tx += now.x - prev.x;
    state.ty += now.y - prev.y;
    render();
    return;
  }
  // Two-finger pinch / rotate using the first two active pointers.
  const [a, b] = ids;
  if (e.pointerId !== a && e.pointerId !== b) return;
  const p1 = pointers.get(a), p2 = pointers.get(b);
  pointers.set(e.pointerId, now);
  const q1 = pointers.get(a), q2 = pointers.get(b);
  const dOld = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const dNew = Math.hypot(q2.x - q1.x, q2.y - q1.y);
  if (dOld < 1) return;
  const dr = Math.atan2(q2.y - q1.y, q2.x - q1.x) - Math.atan2(p2.y - p1.y, p2.x - p1.x);
  applyGesture(
    { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 },
    dNew / dOld,
    dr,
  );
  showTransformHud();
});
const endPointer = (e) => {
  if (pointers.delete(e.pointerId)) save();
};
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

stage.addEventListener('wheel', (e) => {
  if (locked || state.mode !== 'move') return;
  e.preventDefault();
  const m = { x: e.clientX, y: e.clientY };
  if (e.shiftKey || e.altKey) {
    applyGesture(m, m, 1, (e.deltaY || e.deltaX) * 0.004);
  } else {
    applyGesture(m, m, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 0);
  }
  showTransformHud();
  save();
}, { passive: false });

// Safari's own pinch gestures on the page.
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) =>
  document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest?.('#toolbar')) e.preventDefault();
}, { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

function rotateBy(rad) {
  // rotate about screen centre of image
  state.r = Math.round((state.r + rad) / (Math.PI / 2)) * (Math.PI / 2);
  render(); showTransformHud(); save();
}
$('#rotL').addEventListener('click', () => rotateBy(-Math.PI / 2));
$('#rotR').addEventListener('click', () => rotateBy(Math.PI / 2));
$('#flipH').addEventListener('click', () => { state.fx *= -1; render(); save(); });
$('#flipV').addEventListener('click', () => { state.fy *= -1; render(); save(); });
$('#fit').addEventListener('click', () => { fitImage(); showTransformHud(); });
$('#opacity').addEventListener('input', (e) => { state.opacity = +e.target.value; render(); save(); });
$('#gray').addEventListener('click', () => { state.gray = !state.gray; render(); syncUi(); save(); });
$('#showImg').addEventListener('click', () => toggleImage());
function toggleImage() { state.showImage = !state.showImage; render(); syncUi(); save(); }

// ---------------------------------------------------------------- drawing
let strokes = [];
let redoStack = [];
let active = null; // { id, stroke }

function resizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}

function widthAt(st, p) {
  return st.pressure ? st.size * (0.25 + 0.95 * p) : st.size;
}
function drawSegment(c, st, i) {
  const pts = st.pts;
  const [x1, y1, p1] = pts[i];
  const [x0, y0, p0] = i > 0 ? pts[i - 1] : pts[i];
  c.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
  c.strokeStyle = st.color;
  c.fillStyle = st.color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = widthAt(st, (p0 + p1) / 2);
  if (i === 0) {
    c.beginPath();
    c.arc(x1, y1, widthAt(st, p1) / 2, 0, Math.PI * 2);
    c.fill();
    return;
  }
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}
function drawStrokes(c, list) {
  for (const st of list) for (let i = 0; i < st.pts.length; i++) drawSegment(c, st, i);
  c.globalCompositeOperation = 'source-over';
}
function redraw() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  drawStrokes(ctx, strokes);
}

let strokeSaveTimer;
function saveStrokes() {
  clearTimeout(strokeSaveTimer);
  strokeSaveTimer = setTimeout(() => idb.set('strokes', strokes), 400);
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'draw' || locked || active) return;
  if (state.pencilOnly && e.pointerType === 'touch') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  const stroke = {
    tool: state.tool,
    color: state.color,
    size: state.tool === 'eraser' ? state.size * 3 : state.size,
    pressure: e.pointerType === 'pen',
    pts: [[e.clientX, e.clientY, e.pressure || 0.5]],
  };
  active = { id: e.pointerId, stroke };
  strokes.push(stroke);
  redoStack = [];
  lastCleared = null;
  drawSegment(ctx, stroke, 0);
  syncUi();
});
canvas.addEventListener('pointermove', (e) => {
  if (!active || e.pointerId !== active.id) return;
  const evs = e.getCoalescedEvents?.() || [e];
  const st = active.stroke;
  for (const ev of evs.length ? evs : [e]) {
    const last = st.pts[st.pts.length - 1];
    if (Math.abs(ev.clientX - last[0]) + Math.abs(ev.clientY - last[1]) < 0.5) continue;
    st.pts.push([ev.clientX, ev.clientY, ev.pressure || 0.5]);
    drawSegment(ctx, st, st.pts.length - 1);
  }
  ctx.globalCompositeOperation = 'source-over';
});
const endStroke = (e) => {
  if (!active || e.pointerId !== active.id) return;
  active = null;
  saveStrokes();
  syncUi();
};
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

let lastCleared = null; // strokes removed by Clear, restorable with Undo

function undo() {
  if (!strokes.length && lastCleared) {
    strokes = lastCleared;
    lastCleared = null;
  } else if (strokes.length) {
    redoStack.push(strokes.pop());
  } else return;
  redraw(); saveStrokes(); syncUi();
}
function redo() {
  if (!redoStack.length) return;
  strokes.push(redoStack.pop());
  redraw(); saveStrokes(); syncUi();
}
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#clear').addEventListener('click', () => {
  if (!strokes.length) return;
  lastCleared = strokes;
  strokes = [];
  redoStack = [];
  redraw(); saveStrokes(); syncUi();
  toast('Drawing cleared — tap Undo to restore');
});

$('#toolPen').addEventListener('click', () => { state.tool = 'pen'; syncUi(); save(); });
$('#toolEraser').addEventListener('click', () => { state.tool = 'eraser'; syncUi(); save(); });
$('#color').addEventListener('input', (e) => { state.color = e.target.value; state.tool = 'pen'; syncUi(); save(); });
$('#size').addEventListener('input', (e) => { state.size = +e.target.value; hud(`Size ${state.size}`); save(); });
$('#pencilOnly').addEventListener('click', () => {
  state.pencilOnly = !state.pencilOnly;
  toast(state.pencilOnly ? 'Only Apple Pencil / mouse will draw' : 'Fingers draw too');
  syncUi(); save();
});

// ---------------------------------------------------------------- export
const exportSheet = $('#exportSheet');
$('#export').addEventListener('click', () => {
  if (!strokes.length) return toast('Nothing drawn yet');
  $('#exportError').hidden = true;
  exportSheet.hidden = false;
});
$('#expCancel').addEventListener('click', () => (exportSheet.hidden = true));
$('#expDrawing').addEventListener('click', () => doExport({ bg: null, withImage: false }));
$('#expDrawingWhite').addEventListener('click', () => doExport({ bg: '#ffffff', withImage: false }));
$('#expBoth').addEventListener('click', () => doExport({ bg: '#ffffff', withImage: true }));

function strokeBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of strokes) {
    if (st.tool === 'eraser') continue;
    const pad = st.size;
    for (const [x, y] of st.pts) {
      x0 = Math.min(x0, x - pad); y0 = Math.min(y0, y - pad);
      x1 = Math.max(x1, x + pad); y1 = Math.max(y1, y + pad);
    }
  }
  if (!isFinite(x0)) return null;
  return { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) };
}

async function doExport({ bg, withImage }) {
  const errEl = $('#exportError');
  errEl.hidden = true;
  try {
    const scale = Math.max(2, Math.min(devicePixelRatio || 1, 3));
    const full = { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const box = $('#expTrim').checked ? strokeBounds() || full : full;
    // Drawing goes on its own layer so the eraser can't punch through the image/background.
    const layer = document.createElement('canvas');
    layer.width = Math.round(box.w * scale);
    layer.height = Math.round(box.h * scale);
    const lc = layer.getContext('2d');
    lc.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
    drawStrokes(lc, strokes);

    const out = document.createElement('canvas');
    out.width = layer.width;
    out.height = layer.height;
    const oc = out.getContext('2d');
    if (bg) { oc.fillStyle = bg; oc.fillRect(0, 0, out.width, out.height); }
    if (withImage && img.src) {
      if (img.dataset.tainted) throw new Error("That image's host doesn't allow it to be exported. Download it and use “Choose image” instead.");
      oc.save();
      oc.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
      oc.translate(state.tx, state.ty);
      oc.rotate(state.r);
      oc.scale(state.s * state.fx, state.s * state.fy);
      oc.globalAlpha = state.opacity;
      oc.filter = state.gray ? 'grayscale(1)' : 'none';
      oc.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      oc.restore();
    }
    oc.drawImage(layer, 0, 0);
    const blob = await new Promise((res, rej) =>
      out.toBlob((b) => (b ? res(b) : rej(new Error('Export failed'))), 'image/png'));
    const name = `freetrace-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const touchy = matchMedia('(pointer: coarse)').matches;
    if (touchy && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        exportSheet.hidden = true;
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    exportSheet.hidden = true;
  } catch (e) {
    errEl.textContent = e.message || String(e);
    errEl.hidden = false;
  }
}

// ---------------------------------------------------------------- modes & UI
function setMode(m) {
  state.mode = m;
  pointers.clear();
  syncUi();
  save();
}
$('#modeMove').addEventListener('click', () => setMode('move'));
$('#modeDraw').addEventListener('click', () => setMode('draw'));

function setBarHidden(h) {
  state.barHidden = h;
  syncUi();
  save();
}
$('#hideBar').addEventListener('click', () => setBarHidden(true));
$('#showBar').addEventListener('click', () => setBarHidden(false));

function syncUi() {
  document.body.classList.toggle('mode-draw', state.mode === 'draw');
  $('#modeMove').setAttribute('aria-checked', state.mode === 'move');
  $('#modeDraw').setAttribute('aria-checked', state.mode === 'draw');
  $('#moveTools').hidden = state.mode !== 'move';
  $('#drawTools').hidden = state.mode !== 'draw';
  $('#toolPen').setAttribute('aria-checked', state.tool === 'pen');
  $('#toolEraser').setAttribute('aria-checked', state.tool === 'eraser');
  $('#gray').setAttribute('aria-pressed', state.gray);
  $('#pencilOnly').setAttribute('aria-pressed', state.pencilOnly);
  $('#showImg').setAttribute('aria-pressed', state.showImage);
  $('#showImg').textContent = state.showImage ? 'Image shown' : 'Image hidden';
  $('#opacity').value = state.opacity;
  $('#color').value = state.color;
  $('#size').value = state.size;
  $('#undo').disabled = !strokes.length && !lastCleared;
  $('#redo').disabled = !redoStack.length;
  $('#toolbar').hidden = state.barHidden;
  $('#showBar').hidden = !state.barHidden;
}

// ---------------------------------------------------------------- lock + wake
let locked = false;
let wakeLock = null;

async function requestWake() {
  if (!('wakeLock' in navigator)) return false;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    return true;
  } catch (e) {
    console.warn('wake lock', e);
    return false;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && locked && !wakeLock) requestWake();
});

async function lock() {
  if (locked) return;
  locked = true;
  pointers.clear();
  active = null;
  document.body.classList.add('locked');
  $('#lock').hidden = false;
  const fs = document.documentElement;
  try {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const req = fs.requestFullscreen || fs.webkitRequestFullscreen;
      await req?.call(fs, { navigationUI: 'hide' });
    }
  } catch {}
  const ok = await requestWake();
  toast(ok
    ? 'Locked — screen will stay awake. Hold the corner button to unlock.'
    : 'Locked. This browser can’t keep the screen awake — set Auto-Lock to Never in Settings.', 4000);
}
function unlock() {
  locked = false;
  document.body.classList.remove('locked');
  $('#lock').hidden = true;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  toast('Unlocked');
}
$('#lockBtn').addEventListener('click', lock);

// Swallow every interaction on the lock overlay.
const lockEl = $('#lock');
['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu', 'touchstart', 'touchend', 'wheel'].forEach((t) =>
  lockEl.addEventListener(t, (e) => {
    if (!e.target.closest('#unlock')) { e.preventDefault(); e.stopPropagation(); }
  }, { passive: false }));

const HOLD_MS = 1200;
const unlockBtn = $('#unlock');
unlockBtn.style.setProperty('--hold', HOLD_MS / 1000 + 's');
let holdTimer = null;
function startHold(e) {
  e.preventDefault();
  if (holdTimer) return;
  unlockBtn.classList.add('holding');
  holdTimer = setTimeout(() => { cancelHold(); unlock(); }, HOLD_MS);
}
function cancelHold() {
  clearTimeout(holdTimer);
  holdTimer = null;
  unlockBtn.classList.remove('holding');
}
unlockBtn.addEventListener('pointerdown', startHold);
['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => unlockBtn.addEventListener(t, cancelHold));
unlockBtn.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- keyboard
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (locked) {
    if (e.key === 'Escape') toast('Hold the corner button to unlock');
    e.preventDefault();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod) return;
  const step = e.shiftKey ? 10 : 1;
  const k = e.key;
  const actions = {
    ArrowLeft: () => { state.tx -= step; render(); },
    ArrowRight: () => { state.tx += step; render(); },
    ArrowUp: () => { state.ty -= step; render(); },
    ArrowDown: () => { state.ty += step; render(); },
    '+': () => { applyGesture({ x: state.tx, y: state.ty }, { x: state.tx, y: state.ty }, 1.05, 0); showTransformHud(); },
    '=': () => actions['+'](),
    '-': () => { applyGesture({ x: state.tx, y: state.ty }, { x: state.tx, y: state.ty }, 1 / 1.05, 0); showTransformHud(); },
    '[': () => rotateBy(-Math.PI / 2),
    ']': () => rotateBy(Math.PI / 2),
    ',': () => { state.r -= Math.PI / 180; render(); showTransformHud(); },
    '.': () => { state.r += Math.PI / 180; render(); showTransformHud(); },
    h: () => $('#flipH').click(),
    v: () => $('#flipV').click(),
    f: () => $('#fit').click(),
    m: () => setMode('move'),
    d: () => setMode('draw'),
    p: () => $('#toolPen').click(),
    e: () => $('#toolEraser').click(),
    i: () => toggleImage(),
    l: () => lock(),
    Tab: () => setBarHidden(!state.barHidden),
  };
  const fn = actions[k] || actions[k.toLowerCase?.()];
  if (fn) { e.preventDefault(); fn(); save(); }
});

// ---------------------------------------------------------------- boot
addEventListener('resize', () => { resizeCanvas(); });

async function boot() {
  resizeCanvas();
  syncUi();
  render();

  const qs = new URLSearchParams(location.search);
  const qsrc = qs.get('src') || qs.get('url') || qs.get('img');

  const saved = await idb.get('strokes');
  if (Array.isArray(saved)) { strokes = saved; redraw(); syncUi(); }

  try {
    if (qsrc) {
      await loadUrl(qsrc, { fit: true });
      history.replaceState(null, '', location.pathname);
    } else if (state.src?.kind === 'blob') {
      const blob = await idb.get('image');
      if (blob) await loadBlob(blob, { fit: false, persist: false });
      else throw new Error('no saved image');
    } else if (state.src?.kind === 'url') {
      await setImgSrc(state.src.url, false);
      render();
    } else {
      openPicker(true);
    }
  } catch (e) {
    state.src = null;
    openPicker(true);
    if (qsrc) pickerError(e);
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
