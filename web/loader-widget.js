// FileHubLoader UI — fully canvas-rendered.
// Layout (top of node body, below the title bar):
//   - Pin row: N tiles, top-left, parallel to the output socket column.
//   - Action button row (horizontal text buttons), full-width, ABOVE recents.
//     Buttons: [Browse] [Pin sets] [Refresh] [Source: <tab> ▾]
//   - Recents row: smaller tiles below the action button row.
// Icon-size preset (small/medium/large) controls pin + recent tile sizes.

import { openBrowserModal, openPinsetModal } from "./pinset-modal.js";

const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;

const ICON = { video: "▶", audio: "♪", other: "?", image: "" };

const PLACEHOLDER_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2a2a2a"/><text x="32" y="36" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#666">+</text></svg>`,
  );

const DEFAULT_STATE = () => ({
  active: null,
  active_index: null,
  pins: [null, null, null, null],
  recents: [],
  pin_count: 4,
  recents_count: 6,
  source_tab: "input",
  auto_roll: false,
  icon_size: "medium",
});

// --- Layout: size presets and constants -------------------------------------

const SIZE_PRESETS = {
  small:  { pin: 48, recent: 32 },
  medium: { pin: 64, recent: 48 },
  large:  { pin: 80, recent: 64 },
};
function tileSizes(state) {
  return SIZE_PRESETS[state.icon_size] || SIZE_PRESETS.medium;
}

const PAD_X = 8;
const PIN_GAP = 4;
const PIN_PAD_Y = 4;
const REC_GAP = 4;
const PIN_TO_ACTION_GAP = 8;
const ACTION_TO_RECENTS_GAP = 4;
const ACTION_BTN_H = 22;
const ACTION_BTN_PAD_X = 10;
const ACTION_BTN_GAP = 4;
const SOCKET_COL_W = 96;

const ACTION_FONT = "11px sans-serif";

function pinSlotRect(i, state) {
  const { pin } = tileSizes(state);
  return { x: PAD_X + i * (pin + PIN_GAP), w: pin, h: pin };
}
function pinGridWidth(count, state) {
  const { pin } = tileSizes(state);
  return PAD_X * 2 + count * pin + (count - 1) * PIN_GAP;
}
function recSlotRect(i, state) {
  const { recent } = tileSizes(state);
  return { x: PAD_X + i * (recent + REC_GAP), w: recent, h: recent };
}

function thumbUrl(slot) {
  if (!slot || !slot.filename) return PLACEHOLDER_SVG;
  const ext = (slot.filename.split(".").pop() || "").toLowerCase();
  const isImage = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "tif"].includes(ext);
  const isVideo = ["mp4", "mov", "webm", "mkv", "avi"].includes(ext);
  const params = new URLSearchParams({
    type: slot.type,
    subfolder: slot.subfolder || "",
    filename: slot.filename,
  });
  if (isImage) {
    params.set("preview", "webp;90");
    params.set("channel", "rgb");
    return `/view?${params}`;
  }
  if (isVideo) return `/filehub/poster?${params}`;
  return PLACEHOLDER_SVG;
}

function kindOf(slot) {
  if (!slot || !slot.filename) return "image";
  const ext = (slot.filename.split(".").pop() || "").toLowerCase();
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "flac", "ogg", "m4a", "aac"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "tif"].includes(ext)) return "image";
  return "other";
}

function hideStringWidget(w) {
  w.computeSize = () => [0, -4];
  w.draw = () => {};
  for (const k of ["inputEl", "element", "domWidget"]) {
    const el = w[k];
    if (el && el.style) el.style.display = "none";
  }
}

function slotEqual(a, b) {
  if (!a || !b) return a === b;
  return a.type === b.type && a.subfolder === b.subfolder && a.filename === b.filename;
}

export function mountLoader(node) {
  const selWidget = node.widgets?.find((w) => w.name === "selection");
  if (!selWidget) {
    console.warn("[FileHub] selection widget missing on FileHubLoader");
    return;
  }
  hideStringWidget(selWidget);

  const state = DEFAULT_STATE();
  node._fh = state;

  function loadStateFromWidget() {
    try {
      const parsed = JSON.parse(selWidget.value || "{}");
      Object.assign(state, DEFAULT_STATE(), parsed);
    } catch {
      Object.assign(state, DEFAULT_STATE());
    }
    if (!Array.isArray(state.pins)) state.pins = [];
    while (state.pins.length < state.pin_count) state.pins.push(null);
    state.pins.length = state.pin_count;
    if (!Array.isArray(state.recents)) state.recents = [];
    if (!SIZE_PRESETS[state.icon_size]) state.icon_size = "medium";
  }
  loadStateFromWidget();

  function writeBack() {
    selWidget.value = JSON.stringify(state);
    if (selWidget.callback) selWidget.callback(selWidget.value);
  }

  // --- Image caches ---------------------------------------------------------

  const pinImages = new Array(state.pin_count).fill(null);
  const recentImages = [];

  function loadImageInto(target, idx, slot) {
    if (!slot) {
      target[idx] = null;
      return;
    }
    const url = thumbUrl(slot);
    if (target[idx] && target[idx]._fhUrl === url && target[idx].complete) return;
    const img = new Image();
    img._fhUrl = url;
    img.onload = () => node.setDirtyCanvas(true, true);
    img.onerror = () => {
      if (img._fhUrl !== PLACEHOLDER_SVG) {
        img._fhUrl = PLACEHOLDER_SVG;
        img.src = PLACEHOLDER_SVG;
      }
    };
    img.src = url;
    target[idx] = img;
  }

  function refreshPinImages() {
    for (let i = 0; i < state.pin_count; i++) loadImageInto(pinImages, i, state.pins[i]);
    node.setDirtyCanvas(true, true);
  }

  function refreshRecentImages() {
    recentImages.length = state.recents.length;
    for (let i = 0; i < state.recents.length; i++) loadImageInto(recentImages, i, state.recents[i]);
    node.setDirtyCanvas(true, true);
  }

  // --- Layout helpers -------------------------------------------------------

  function titleH() {
    return (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) || 30;
  }
  function pinAreaTop() { return titleH() + PIN_PAD_Y; }
  function actionRowTop() {
    return pinAreaTop() + tileSizes(state).pin + PIN_TO_ACTION_GAP;
  }
  function recentsAreaTop() {
    return actionRowTop() + ACTION_BTN_H + ACTION_TO_RECENTS_GAP;
  }
  function bodyMinHeight() {
    const { recent } = tileSizes(state);
    return PIN_PAD_Y + tileSizes(state).pin + PIN_TO_ACTION_GAP + ACTION_BTN_H + ACTION_TO_RECENTS_GAP + recent + 8;
  }

  // --- Action buttons (horizontal row above recents) ------------------------

  // Each entry: { label: string|()=>string, click: (e)=>void, contextClick?: (e)=>void }
  const actionDefs = [
    { label: () => "Browse",   click: () => openBrowser() },
    { label: () => "Pin sets", click: () => openPinsetsAction() },
    { label: () => "Refresh",  click: () => refreshRecents() },
    { label: () => `Source: ${state.source_tab} ▾`, click: (e) => openSourceMenu(e) },
  ];
  // Each draw cycle populates this from the live ctx (we need ctx to measure text).
  let actionRects = [];

  function buttonLabel(d) {
    return typeof d.label === "function" ? d.label() : d.label;
  }

  function measureButtonWidth(ctx, label) {
    ctx.font = ACTION_FONT;
    return Math.ceil(ctx.measureText(label).width) + ACTION_BTN_PAD_X * 2;
  }

  function actionHitTest(localX, localY) {
    for (let i = 0; i < actionRects.length; i++) {
      const r = actionRects[i];
      if (!r) continue;
      if (localX >= r.x && localX <= r.x + r.w && localY >= r.y && localY <= r.y + r.h) return i;
    }
    return -1;
  }

  // --- Hit tests: pins + recents -------------------------------------------

  function pinHitTest(localX, localY) {
    const top = pinAreaTop();
    const { pin } = tileSizes(state);
    if (localY < top || localY > top + pin) return -1;
    for (let i = 0; i < state.pin_count; i++) {
      const r = pinSlotRect(i, state);
      if (localX >= r.x && localX <= r.x + r.w) return i;
    }
    return -1;
  }
  function recentHitTest(localX, localY) {
    const top = recentsAreaTop();
    const { recent } = tileSizes(state);
    if (localY < top || localY > top + recent) return -1;
    for (let i = 0; i < state.recents.length; i++) {
      const r = recSlotRect(i, state);
      if (localX >= r.x && localX <= r.x + r.w) return i;
    }
    return -1;
  }

  // --- Drawing primitives ---------------------------------------------------

  function drawTile(ctx, x, y, size, slot, img, opts = {}) {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(x, y, size, size);

    if (slot && img && img.complete && img.naturalWidth > 0) {
      const ratio = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * ratio;
      const h = img.naturalHeight * ratio;
      ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
    } else if (!slot) {
      ctx.save();
      ctx.strokeStyle = "#444";
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
      ctx.setLineDash([]);
      if (size >= 40) {
        ctx.fillStyle = "#555";
        ctx.font = `${Math.floor(size / 3)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("+", x + size / 2, y + size / 2);
      }
      ctx.restore();
    }

    const isActive = !!opts.active;
    ctx.strokeStyle = isActive ? "#46b4e6" : "#333";
    ctx.lineWidth = isActive ? 2 : 1;
    const inset = isActive ? 1 : 0.5;
    ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
    ctx.lineWidth = 1;

    if (opts.label) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x + 2, y + 2, 12, 11);
      ctx.fillStyle = "#aaa";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(opts.label, x + 4, y + 3);
    }

    if (slot) {
      const k = kindOf(slot);
      if (k !== "image") {
        const iconSize = size >= 48 ? 12 : 10;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(x + size - iconSize - 2, y + size - iconSize - 1, iconSize, iconSize - 1);
        ctx.fillStyle = "#ddd";
        ctx.font = `${iconSize - 3}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ICON[k] || ICON.other, x + size - iconSize / 2 - 2, y + size - iconSize / 2 - 1);
      }
    }
  }

  function drawTextButton(ctx, x, y, w, h, label) {
    ctx.fillStyle = "#262626";
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = "#ddd";
    ctx.font = ACTION_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  }

  // --- onDrawForeground -----------------------------------------------------

  const origDraw = node.onDrawForeground;
  node.onDrawForeground = function (ctx) {
    if (origDraw) origDraw.apply(this, arguments);
    if (this.flags?.collapsed) return;

    const { pin, recent } = tileSizes(state);

    // Pin row
    const pinTop = pinAreaTop();
    for (let i = 0; i < state.pin_count; i++) {
      const r = pinSlotRect(i, state);
      drawTile(ctx, r.x, pinTop, pin, state.pins[i], pinImages[i], {
        active: state.active_index === i && !!state.pins[i],
        label: String(i + 1),
      });
    }

    // Action button row (above recents)
    const actY = actionRowTop();
    let cursorX = PAD_X;
    actionRects = [];
    for (let i = 0; i < actionDefs.length; i++) {
      const lbl = buttonLabel(actionDefs[i]);
      const w = measureButtonWidth(ctx, lbl);
      drawTextButton(ctx, cursorX, actY, w, ACTION_BTN_H, lbl);
      actionRects.push({ x: cursorX, y: actY, w, h: ACTION_BTN_H });
      cursorX += w + ACTION_BTN_GAP;
    }

    // Recents row
    const recTop = recentsAreaTop();
    if (!state.recents.length) {
      ctx.fillStyle = "#555";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("(no recents)", PAD_X, recTop + recent / 3);
    } else {
      for (let i = 0; i < state.recents.length; i++) {
        const r = recSlotRect(i, state);
        const slot = state.recents[i];
        const isActive =
          state.active_index === null && state.active && slotEqual(state.active, slot);
        drawTile(ctx, r.x, recTop, recent, slot, recentImages[i], { active: isActive });
      }
    }
  };

  // --- Mouse handling -------------------------------------------------------

  const origMouseDown = node.onMouseDown;
  node.onMouseDown = function (e, localPos) {
    const lx = localPos[0], ly = localPos[1];

    const ai = actionHitTest(lx, ly);
    if (ai >= 0) {
      const def = actionDefs[ai];
      if (e.button === 2) {
        if (def.contextClick) def.contextClick(e);
        else openSettingsMenu(e);
      } else if (e.button === 0) {
        def.click(e);
      }
      return true;
    }

    const pi = pinHitTest(lx, ly);
    if (pi >= 0) {
      if (e.button === 2) openPinContextMenu(pi, e);
      else if (e.button === 0) {
        if (state.pins[pi]) activatePin(pi);
        else openBrowser({ targetSlot: pi });
      }
      return true;
    }

    const ri = recentHitTest(lx, ly);
    if (ri >= 0) {
      if (e.button === 2) openRecentContextMenu(ri, e);
      else if (e.button === 0) activateAdHoc(state.recents[ri]);
      return true;
    }

    return origMouseDown ? origMouseDown.apply(this, arguments) : false;
  };

  // Reset cursor on hover so it isn't a crosshair (litegraph default for some
  // canvas regions). Setting on the canvas element directly works across the
  // whole node body.
  const origMouseEnter = node.onMouseEnter;
  node.onMouseEnter = function (e) {
    if (origMouseEnter) origMouseEnter.apply(this, arguments);
    const c = app?.canvas?.canvas;
    if (c) c.style.cursor = "default";
  };
  const origMouseLeave = node.onMouseLeave;
  node.onMouseLeave = function (e) {
    if (origMouseLeave) origMouseLeave.apply(this, arguments);
    const c = app?.canvas?.canvas;
    if (c) c.style.cursor = "";
  };

  // --- Sizing ---------------------------------------------------------------

  function actionRowMinWidth() {
    // Approximate: rough text measurement without ctx (~7 px/char + padding).
    const labels = actionDefs.map(buttonLabel);
    let w = PAD_X * 2;
    for (let i = 0; i < labels.length; i++) {
      w += Math.ceil(labels[i].length * 6.5) + ACTION_BTN_PAD_X * 2;
      if (i > 0) w += ACTION_BTN_GAP;
    }
    return w;
  }
  function minWidth() {
    return Math.max(
      360,
      pinGridWidth(state.pin_count, state) + SOCKET_COL_W,
      actionRowMinWidth(),
    );
  }

  const origComputeSize = node.computeSize;
  node.computeSize = function () {
    const sz = origComputeSize ? origComputeSize.apply(this, arguments) : [minWidth(), 60];
    sz[0] = Math.max(sz[0], minWidth());
    sz[1] = Math.max(sz[1], titleH() + bodyMinHeight());
    return sz;
  };
  function reflowToMinSize() {
    if (!node.size || node.size[0] < minWidth() || node.size[1] < titleH() + bodyMinHeight()) {
      node.size = node.computeSize();
    }
    node.setDirtyCanvas(true, true);
  }
  reflowToMinSize();

  // --- Actions --------------------------------------------------------------

  function activatePin(i) {
    const slot = state.pins[i];
    if (!slot) return;
    state.active_index = i;
    state.active = { ...slot };
    node.setDirtyCanvas(true, true);
    writeBack();
  }
  function activateAdHoc(slot) {
    state.active_index = null;
    state.active = { ...slot };
    node.setDirtyCanvas(true, true);
    writeBack();
  }
  function setPin(i, slot) {
    state.pins[i] = slot ? { ...slot } : null;
    if (state.active_index === i) state.active = slot ? { ...slot } : null;
    refreshPinImages();
    writeBack();
  }

  function openBrowser({ targetSlot } = {}) {
    openBrowserModal({
      defaultType: state.source_tab,
      onPick: (slots) => {
        if (!slots?.length) return;
        if (Number.isInteger(targetSlot)) {
          setPin(targetSlot, slots[0]);
          activatePin(targetSlot);
          return;
        }
        let placed = 0;
        for (let i = 0; i < state.pin_count && placed < slots.length; i++) {
          if (!state.pins[i]) state.pins[i] = { ...slots[placed++] };
        }
        refreshPinImages();
        writeBack();
        if (placed === 0 && slots.length) activateAdHoc(slots[0]);
      },
    });
  }

  function openPinsetsAction() {
    openPinsetModal({
      currentPins: state.pins,
      onLoad: (slots) => {
        state.pins = slots.slice(0, state.pin_count);
        while (state.pins.length < state.pin_count) state.pins.push(null);
        refreshPinImages();
        writeBack();
      },
    });
  }

  async function uploadAndPin(file, slotIdx) {
    if (!file.name || /[\/:?]|^https?:/i.test(file.name)) {
      console.warn("[FileHub] ignoring drop with URL-shaped name:", file.name);
      return;
    }
    const fd = new FormData();
    fd.append("image", file, file.name);
    fd.append("type", "input");
    fd.append("overwrite", "false");
    let resp;
    try {
      resp = await fetch("/upload/image", { method: "POST", body: fd });
    } catch (e) {
      console.error("[FileHub] upload failed", e);
      return;
    }
    if (!resp.ok) {
      console.error("[FileHub] upload status", resp.status);
      return;
    }
    const json = await resp.json();
    const slot = {
      type: json.type || "input",
      subfolder: json.subfolder || "",
      filename: json.name,
    };
    setPin(slotIdx, slot);
    activatePin(slotIdx);
  }

  // --- Context menus --------------------------------------------------------

  function openSourceMenu(event) {
    const items = ["input", "output", "temp"].map((t) => ({
      content: `${t}${state.source_tab === t ? " ✓" : ""}`,
      callback: () => {
        if (state.source_tab === t) return;
        state.source_tab = t;
        writeBack();
        refreshRecents();
        node.setDirtyCanvas(true, true);
      },
    }));
    new LiteGraph.ContextMenu(items, { event });
  }

  function openSettingsMenu(event) {
    const items = [
      ...["small", "medium", "large"].map((s) => ({
        content: `Icon size: ${s}${state.icon_size === s ? " ✓" : ""}`,
        callback: () => {
          if (state.icon_size === s) return;
          state.icon_size = s;
          writeBack();
          reflowToMinSize();
        },
      })),
      null,
      {
        content: `Auto-roll latest output into slot 1${state.auto_roll ? " ✓" : ""}`,
        callback: () => {
          state.auto_roll = !state.auto_roll;
          writeBack();
        },
      },
    ];
    new LiteGraph.ContextMenu(items, { event });
  }

  function openPinContextMenu(i, event) {
    const slot = state.pins[i];
    const items = [];
    if (slot) items.push({ content: "Activate", callback: () => activatePin(i) });
    items.push({
      content: "Replace from filesystem…",
      callback: () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.onchange = () => {
          const f = inp.files?.[0];
          if (f) uploadAndPin(f, i);
        };
        inp.click();
      },
    });
    items.push({ content: "Browse…", callback: () => openBrowser({ targetSlot: i }) });
    if (slot && slot.type !== "input") {
      items.push({
        content: "Promote to input/",
        callback: async () => {
          try {
            const r = await fetch("/filehub/promote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                from_type: slot.type,
                from_subfolder: slot.subfolder || "",
                from_filename: slot.filename,
              }),
            });
            if (r.ok) {
              const j = await r.json();
              setPin(i, { type: j.type, subfolder: j.subfolder || "", filename: j.filename });
            }
          } catch (e) {
            console.error("[FileHub] promote failed", e);
          }
        },
      });
    }
    if (slot) {
      items.push({
        content: "Delete file (soft)",
        callback: async () => {
          if (!confirm(`Move ${slot.filename} to ${slot.type}/.filehub_trash/ ?`)) return;
          try {
            await fetch("/filehub/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: slot.type,
                subfolder: slot.subfolder || "",
                filename: slot.filename,
              }),
            });
            setPin(i, null);
          } catch (e) {
            console.error("[FileHub] delete failed", e);
          }
        },
      });
      items.push({ content: "Unpin", callback: () => setPin(i, null) });
    }
    new LiteGraph.ContextMenu(items, { event });
  }

  function openRecentContextMenu(ri, event) {
    const slot = state.recents[ri];
    if (!slot) return;
    const items = [
      { content: "Activate (ad hoc)", callback: () => activateAdHoc(slot) },
      null,
      ...Array.from({ length: state.pin_count }, (_, i) => ({
        content: `Pin to slot ${i + 1}`,
        callback: () => {
          setPin(i, slot);
          activatePin(i);
        },
      })),
    ];
    new LiteGraph.ContextMenu(items, { event });
  }

  // --- Drag-drop (OS files) -------------------------------------------------

  node.onDragOver = function (e) {
    return e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  };
  node.onDragDrop = function (e) {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return false;
    const local = canvasToLocal(e);
    let i = pinHitTest(local[0], local[1]);
    if (i < 0) i = state.pins.findIndex((p) => !p);
    if (i < 0) i = 0;
    uploadAndPin(f, i);
    return true;
  };
  function canvasToLocal(e) {
    const canvas = app?.canvas;
    if (canvas && typeof canvas.convertEventToCanvasOffset === "function") {
      const [cx, cy] = canvas.convertEventToCanvasOffset(e);
      return [cx - node.pos[0], cy - node.pos[1]];
    }
    return [e.offsetX || 0, e.offsetY || 0];
  }

  // --- Recents fetch --------------------------------------------------------

  async function refreshRecents() {
    const src = state.source_tab || "output";
    try {
      const params = new URLSearchParams({
        type: src,
        sort: "mtime",
        kinds: "image,video,audio",
        limit: String(state.recents_count),
      });
      const r = await fetch(`/filehub/list?${params}`);
      if (!r.ok) return;
      const j = await r.json();
      const list = (j.files || []).slice(0, state.recents_count).map((f) => ({
        type: f.type,
        subfolder: f.subfolder || "",
        filename: f.name,
      }));
      state.recents = list;
      if (src === "output" && state.auto_roll && list[0]) {
        state.pins[0] = { ...list[0] };
        refreshPinImages();
      }
      refreshRecentImages();
      writeBack();
    } catch (e) {
      console.error("[FileHub] refreshRecents failed", e);
    }
  }

  // --- Wiring ---------------------------------------------------------------

  const onExec = () => refreshRecents();
  const onPinUpdate = (e) => {
    const d = e.detail;
    if (!d || d.loader_id !== node.id) return;
    if (typeof d.slot !== "number" || d.slot < 0 || d.slot >= state.pin_count) return;
    state.pins[d.slot] = { ...d.pin };
    refreshPinImages();
    writeBack();
  };
  api.addEventListener("execution_success", onExec);
  api.addEventListener("filehub.pin_update", onPinUpdate);

  const origRemoved = node.onRemoved;
  node.onRemoved = function () {
    api.removeEventListener("execution_success", onExec);
    api.removeEventListener("filehub.pin_update", onPinUpdate);
    return origRemoved?.apply(this, arguments);
  };

  const origOnConfigure = node.onConfigure;
  node.onConfigure = function () {
    const r = origOnConfigure?.apply(this, arguments);
    loadStateFromWidget();
    refreshPinImages();
    refreshRecentImages();
    reflowToMinSize();
    setTimeout(() => refreshRecents(), 100);
    return r;
  };

  refreshPinImages();
  setTimeout(() => refreshRecents(), 100);
}
