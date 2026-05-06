// FileHubLoader DOM widget. Owns per-node state, renders pin strip + recents,
// drives the hidden `selection` STRING widget that the Python backend reads.

import { openBrowserModal, openPinsetModal } from "./pinset-modal.js";

const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;

const ICON = {
  video: "▶", audio: "♪", other: "?", image: "",
};

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
});

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
  if (isVideo) {
    return `/filehub/poster?${params}`;
  }
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

// Visually hide a STRING widget without changing its `type` — keeping the native
// type "STRING" ensures the widget value is included in the queued prompt.
// (Setting widget.type = "hidden" risks the frontend filtering it out at prompt build.)
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
  // Find the hidden `selection` widget the backend reads.
  const selWidget = node.widgets?.find((w) => w.name === "selection");
  if (!selWidget) {
    console.warn("[FileHub] selection widget missing on FileHubLoader");
    return;
  }
  hideStringWidget(selWidget);

  // Mutable per-node state. Populated from selWidget.value on mount AND on
  // workflow restore (onConfigure runs *after* widget values are rehydrated).
  // Keep mutating this object — closures below capture it by reference.
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
  }
  loadStateFromWidget();

  // -- DOM scaffold --------------------------------------------------------

  const root = document.createElement("div");
  root.className = "fh-root";

  // Top toolbar: just action buttons (browse / pinsets / refresh).
  const toolbar = document.createElement("div");
  toolbar.className = "fh-tabs";
  const toolbarSpacer = document.createElement("span");
  toolbarSpacer.className = "fh-spacer";
  toolbar.appendChild(toolbarSpacer);

  const browseBtn = document.createElement("button");
  browseBtn.className = "fh-icon-btn";
  browseBtn.title = "Browse files";
  browseBtn.textContent = "···";
  browseBtn.addEventListener("click", () => openBrowser());
  toolbar.appendChild(browseBtn);

  const setBtn = document.createElement("button");
  setBtn.className = "fh-icon-btn";
  setBtn.title = "Pin sets";
  setBtn.textContent = "★";
  setBtn.addEventListener("click", () =>
    openPinsetModal({
      currentPins: state.pins,
      onLoad: (slots) => {
        state.pins = slots.slice(0, state.pin_count);
        while (state.pins.length < state.pin_count) state.pins.push(null);
        renderPins();
        writeBack();
      },
    }),
  );
  toolbar.appendChild(setBtn);

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "fh-icon-btn";
  refreshBtn.title = "Refresh recents";
  refreshBtn.textContent = "⟳";
  refreshBtn.addEventListener("click", () => refreshRecents());
  toolbar.appendChild(refreshBtn);

  // Pinned section
  const pinnedLabel = document.createElement("div");
  pinnedLabel.className = "fh-section-label";
  pinnedLabel.textContent = "Pinned";

  const pinnedStrip = document.createElement("div");
  pinnedStrip.className = "fh-strip";

  // Recents header — label + source-tab selector inline. Tabs filter the
  // recents row's source dir AND the default tab the browser modal opens to.
  const recentsHeader = document.createElement("div");
  recentsHeader.className = "fh-recents-header";
  const recentsLabel = document.createElement("span");
  recentsLabel.className = "fh-section-label";
  recentsLabel.textContent = "Recents";
  recentsHeader.appendChild(recentsLabel);

  const tabs = document.createElement("div");
  tabs.className = "fh-tabs";
  const tabBtns = {};
  for (const t of ["input", "output", "temp"]) {
    const b = document.createElement("button");
    b.className = "fh-tab";
    b.textContent = t;
    b.addEventListener("click", () => {
      if (state.source_tab === t) return;
      state.source_tab = t;
      writeBack();
      renderTabs();
      refreshRecents();
    });
    tabs.appendChild(b);
    tabBtns[t] = b;
  }
  recentsHeader.appendChild(tabs);

  const recentsStrip = document.createElement("div");
  recentsStrip.className = "fh-strip";

  // Active filename ribbon
  const activeName = document.createElement("div");
  activeName.className = "fh-active-name";
  activeName.textContent = "(no file selected)";

  root.appendChild(toolbar);
  root.appendChild(pinnedLabel);
  root.appendChild(pinnedStrip);
  root.appendChild(recentsHeader);
  root.appendChild(recentsStrip);
  root.appendChild(activeName);

  // -- Mount ---------------------------------------------------------------

  node.addDOMWidget("filehub_ui", "FileHubWidget", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 220,
  });
  node.size = node.size || [320, 280];
  if (node.size[0] < 320) node.size[0] = 320;

  // -- Render --------------------------------------------------------------

  function renderTabs() {
    for (const t of Object.keys(tabBtns)) {
      tabBtns[t].classList.toggle("active", state.source_tab === t);
    }
  }

  function renderPins() {
    pinnedStrip.innerHTML = "";
    for (let i = 0; i < state.pin_count; i++) {
      const slot = state.pins[i];
      const el = document.createElement("div");
      el.className = "fh-slot " + (slot ? "filled" : "empty");
      if (state.active_index === i && slot) el.classList.add("active");
      el.dataset.slot = String(i);
      el.draggable = !!slot;

      const num = document.createElement("span");
      num.className = "fh-slot-num";
      num.textContent = String(i + 1);
      el.appendChild(num);

      if (slot) {
        const img = document.createElement("img");
        img.src = thumbUrl(slot);
        img.draggable = false;
        img.onerror = () => {
          img.src = PLACEHOLDER_SVG;
        };
        img.alt = slot.filename;
        el.appendChild(img);

        const k = kindOf(slot);
        if (k !== "image") {
          const icon = document.createElement("span");
          icon.className = "fh-slot-icon";
          icon.textContent = ICON[k] || ICON.other;
          el.appendChild(icon);
        }

        const x = document.createElement("span");
        x.className = "fh-slot-x";
        x.textContent = "×";
        x.title = "Unpin";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          state.pins[i] = null;
          if (state.active_index === i) {
            state.active_index = null;
            state.active = null;
          }
          renderPins();
          renderActive();
          writeBack();
        });
        el.appendChild(x);

        el.title = `${slot.filename} [${slot.type}]`;
        el.addEventListener("click", () => activatePin(i));
        el.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openPinContextMenu(i, e.clientX, e.clientY);
        });

        // drag-out: support reordering / swap by dragging onto another pin slot.
        el.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("application/x-filehub-pin", String(i));
          e.dataTransfer.effectAllowed = "move";
        });
      } else {
        el.title = "Empty pin slot — click to browse, drag a file to upload";
        el.addEventListener("click", () => openBrowser({ targetSlot: i }));
      }

      // drop target
      el.addEventListener("dragover", (e) => {
        if (
          e.dataTransfer.types.includes("Files") ||
          e.dataTransfer.types.includes("application/x-filehub-pin") ||
          e.dataTransfer.types.includes("application/x-filehub-recent")
        ) {
          e.preventDefault();
          el.classList.add("dragover");
        }
      });
      el.addEventListener("dragleave", () => el.classList.remove("dragover"));
      el.addEventListener("drop", async (e) => {
        e.preventDefault();
        el.classList.remove("dragover");
        const pinIdx = e.dataTransfer.getData("application/x-filehub-pin");
        const recentIdx = e.dataTransfer.getData("application/x-filehub-recent");
        if (pinIdx) {
          // swap pins
          const from = parseInt(pinIdx, 10);
          if (Number.isInteger(from) && from !== i) {
            const tmp = state.pins[i];
            state.pins[i] = state.pins[from];
            state.pins[from] = tmp;
            renderPins();
            writeBack();
          }
          return;
        }
        if (recentIdx) {
          const r = parseInt(recentIdx, 10);
          const slotR = state.recents[r];
          if (slotR) {
            state.pins[i] = { ...slotR };
            renderPins();
            writeBack();
          }
          return;
        }
        // file from OS
        const f = e.dataTransfer.files?.[0];
        if (f) await uploadAndPin(f, i);
      });

      pinnedStrip.appendChild(el);
    }
  }

  function renderRecents() {
    recentsStrip.innerHTML = "";
    const list = state.recents.slice(0, state.recents_count);
    if (!list.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "font-size:10px;color:#555;padding:4px;";
      empty.textContent = "(no recents yet)";
      recentsStrip.appendChild(empty);
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const slot = list[i];
      const el = document.createElement("div");
      el.className = "fh-slot fh-recent filled";
      if (state.active && slotEqual(state.active, slot) && state.active_index === null) {
        el.classList.add("active");
      }
      el.draggable = true;
      el.title = `${slot.filename} [${slot.type}]`;

      const img = document.createElement("img");
      img.src = thumbUrl(slot);
      img.draggable = false;
      img.onerror = () => (img.src = PLACEHOLDER_SVG);
      el.appendChild(img);

      const k = kindOf(slot);
      if (k !== "image") {
        const icon = document.createElement("span");
        icon.className = "fh-slot-icon";
        icon.textContent = ICON[k] || ICON.other;
        el.appendChild(icon);
      }

      el.addEventListener("click", () => activateAdHoc(slot));
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-filehub-recent", String(i));
        e.dataTransfer.effectAllowed = "copy";
      });
      recentsStrip.appendChild(el);
    }
  }

  function renderActive() {
    if (state.active && state.active.filename) {
      activeName.textContent = `${state.active.filename} [${state.active.type}${state.active.subfolder ? "/" + state.active.subfolder : ""}]`;
    } else {
      activeName.textContent = "(no file selected)";
    }
  }

  function renderAll() {
    renderTabs();
    renderPins();
    renderRecents();
    renderActive();
  }

  // -- Actions -------------------------------------------------------------

  function activatePin(i) {
    const slot = state.pins[i];
    if (!slot) return;
    state.active_index = i;
    state.active = { ...slot };
    renderPins();
    renderActive();
    writeBack();
  }

  function activateAdHoc(slot) {
    state.active_index = null;
    state.active = { ...slot };
    renderPins();
    renderRecents();
    renderActive();
    writeBack();
  }

  function setPin(i, slot) {
    state.pins[i] = slot ? { ...slot } : null;
    if (state.active_index === i) {
      state.active = slot ? { ...slot } : null;
    }
    renderPins();
    renderActive();
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
        // No specific slot — fill empty slots in order, then overflow into active.
        let placed = 0;
        for (let i = 0; i < state.pin_count && placed < slots.length; i++) {
          if (!state.pins[i]) {
            state.pins[i] = { ...slots[placed++] };
          }
        }
        renderPins();
        writeBack();
        if (placed === 0 && slots.length) {
          // All pins were full; just activate the first picked file ad-hoc.
          activateAdHoc(slots[0]);
        }
      },
    });
  }

  async function uploadAndPin(file, slotIdx) {
    // Guard against synthesized "files" produced by in-page <img> drags
    // (Chrome turns the URL into a File with the URL as its name).
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

  function openPinContextMenu(i, x, y) {
    const slot = state.pins[i];
    if (!slot) return;
    const items = [
      { label: "Activate", run: () => activatePin(i) },
      {
        label: "Replace from filesystem…",
        run: () => {
          const inp = document.createElement("input");
          inp.type = "file";
          inp.onchange = () => {
            const f = inp.files?.[0];
            if (f) uploadAndPin(f, i);
          };
          inp.click();
        },
      },
      { label: "Browse…", run: () => openBrowser({ targetSlot: i }) },
    ];
    if (slot.type !== "input") {
      items.push({
        label: "Promote to input/",
        run: async () => {
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
    items.push({
      label: "Delete file (soft)",
      run: async () => {
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
    items.push({ label: "Unpin", run: () => setPin(i, null) });

    showContextMenu(items, x, y);
  }

  // -- Recents loader ------------------------------------------------------

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
      // Auto-roll only makes sense for outputs (post-generate hot row).
      if (src === "output" && state.auto_roll && list[0]) {
        state.pins[0] = { ...list[0] };
      }
      renderRecents();
      renderPins();
      writeBack();
    } catch (e) {
      console.error("[FileHub] refreshRecents failed", e);
    }
  }

  // -- Wire events ---------------------------------------------------------

  const onExec = () => refreshRecents();
  const onPinUpdate = (e) => {
    const d = e.detail;
    if (!d || d.loader_id !== node.id) return;
    if (typeof d.slot !== "number" || d.slot < 0 || d.slot >= state.pin_count) return;
    state.pins[d.slot] = { ...d.pin };
    renderPins();
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

  // Workflow restore — ComfyUI rehydrates widget values *after* onNodeCreated,
  // so re-read the hidden widget here and re-render once everything's settled.
  const origOnConfigure = node.onConfigure;
  node.onConfigure = function () {
    const r = origOnConfigure?.apply(this, arguments);
    loadStateFromWidget();
    renderAll();
    setTimeout(() => refreshRecents(), 100);
    return r;
  };

  // -- Helpers -------------------------------------------------------------

  function writeBack() {
    selWidget.value = JSON.stringify(state);
    if (selWidget.callback) selWidget.callback(selWidget.value);
  }

  // Initial render + pull recents on mount.
  renderAll();
  // Defer the first network call so we don't race graph init.
  setTimeout(() => refreshRecents(), 100);
}

// -- Tiny context menu (not litegraph; we want it inside the DOM widget) ----

function showContextMenu(items, x, y) {
  const existing = document.getElementById("fh-ctx");
  if (existing) existing.remove();
  const menu = document.createElement("div");
  menu.id = "fh-ctx";
  menu.style.cssText = `position:fixed; z-index:99999; background:#222; border:1px solid #444; border-radius:4px; padding:4px 0; font:11px sans-serif; color:#bbb; box-shadow:0 4px 8px #000a; min-width:160px;`;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const it of items) {
    const row = document.createElement("div");
    row.textContent = it.label;
    row.style.cssText = "padding:4px 12px; cursor:pointer;";
    row.addEventListener("mouseenter", () => (row.style.background = "#333"));
    row.addEventListener("mouseleave", () => (row.style.background = ""));
    row.addEventListener("click", () => {
      menu.remove();
      try {
        it.run();
      } catch (e) {
        console.error(e);
      }
    });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const close = () => {
    menu.remove();
    window.removeEventListener("click", close);
    window.removeEventListener("contextmenu", close);
  };
  setTimeout(() => {
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
  }, 0);
}
