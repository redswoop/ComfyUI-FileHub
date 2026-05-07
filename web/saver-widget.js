// FileHubSaver DOM widget. Drives the hidden `target` STRING widget that the Python
// backend reads. UI surfaces destination + (optional) target loader & pin slot.

const { app } = window.comfyAPI.app;

const DEST_OPTIONS = [
  { value: "output", label: "output/" },
  { value: "input", label: "input/" },
  { value: "both", label: "both" },
  { value: "skip", label: "skip (no save)" },
];

function findLoaderNodes() {
  const graph = app.graph;
  if (!graph || !graph._nodes) return [];
  return graph._nodes.filter((n) => n?.type === "FileHubLoader" || n?.comfyClass === "FileHubLoader");
}

export function mountSaver(node) {
  const tgtWidget = node.widgets?.find((w) => w.name === "target");
  if (!tgtWidget) {
    console.warn("[FileHub] target widget missing on FileHubSaver");
    return;
  }
  tgtWidget.computeSize = () => [0, -4];
  tgtWidget.draw = () => {};
  for (const k of ["inputEl", "element", "domWidget"]) {
    const el = tgtWidget[k];
    if (el && el.style) el.style.display = "none";
  }

  // Mutable state — populated from tgtWidget on mount AND on workflow restore.
  const state = { destination: "output", loader_id: null, slot: null };
  function loadStateFromWidget() {
    Object.assign(state, { destination: "output", loader_id: null, slot: null });
    try {
      const parsed = JSON.parse(tgtWidget.value || "{}");
      Object.assign(state, parsed);
    } catch {}
  }
  loadStateFromWidget();

  const root = document.createElement("div");
  root.className = "fh-root";

  // Destination row
  const destRow = document.createElement("div");
  destRow.className = "fh-saver-row";
  const destLabel = document.createElement("span");
  destLabel.textContent = "Save to:";
  destLabel.style.cssText = "font-size:10px; color:#888; text-transform:uppercase;";
  const destSel = document.createElement("select");
  for (const o of DEST_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    destSel.appendChild(opt);
  }
  destSel.value = state.destination;
  destSel.addEventListener("change", () => {
    state.destination = destSel.value;
    renderTargetVisibility();
    writeBack();
  });
  destRow.appendChild(destLabel);
  destRow.appendChild(destSel);

  // Target loader row (visible when destination !== output-only)
  const tgtRow = document.createElement("div");
  tgtRow.className = "fh-saver-row";
  const tgtLabel = document.createElement("span");
  tgtLabel.textContent = "Pin into:";
  tgtLabel.style.cssText = "font-size:10px; color:#888; text-transform:uppercase;";

  const loaderSel = document.createElement("select");
  // The slot input is 1-based to match the visible pin labels (1,2,3,4 in the
  // loader UI). Internally `state.slot` stays 0-based so the backend doesn't care.
  const slotInp = document.createElement("input");
  slotInp.type = "number";
  slotInp.min = "1";
  slotInp.style.width = "50px";
  slotInp.placeholder = "pin#";
  slotInp.title = "Pin number (1 = first pin slot in the loader)";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "fh-icon-btn";
  refreshBtn.textContent = "⟳";
  refreshBtn.title = "Re-scan loader nodes in the graph";
  refreshBtn.addEventListener("click", () => populateLoaders());

  loaderSel.addEventListener("change", () => {
    const v = loaderSel.value;
    state.loader_id = v === "" ? null : parseInt(v, 10);
    writeBack();
  });
  slotInp.addEventListener("change", () => {
    const n = parseInt(slotInp.value, 10);
    // UI is 1-based; convert to 0-based for storage.
    state.slot = Number.isFinite(n) && n >= 1 ? n - 1 : null;
    writeBack();
  });

  tgtRow.appendChild(tgtLabel);
  tgtRow.appendChild(loaderSel);
  tgtRow.appendChild(slotInp);
  tgtRow.appendChild(refreshBtn);

  root.appendChild(destRow);
  root.appendChild(tgtRow);

  node.addDOMWidget("filehub_saver_ui", "FileHubSaverWidget", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 70,
  });
  // Only enforce a minimum width (so the destination dropdown doesn't squish);
  // leave height to ComfyUI so OUTPUT_NODE image previews can expand the node.
  if (!node.size || node.size[0] < 320) {
    node.size = [320, node.size?.[1] ?? -1];
    if (node.size[1] < 0 && typeof node.computeSize === "function") {
      node.size[1] = node.computeSize()[1];
    }
  }

  function populateLoaders() {
    loaderSel.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "(none)";
    loaderSel.appendChild(empty);
    const loaders = findLoaderNodes();
    for (const ln of loaders) {
      const opt = document.createElement("option");
      opt.value = String(ln.id);
      const title = ln.title || ln.type || "FileHubLoader";
      opt.textContent = `#${ln.id} ${title}`;
      loaderSel.appendChild(opt);
    }
    if (state.loader_id != null) {
      loaderSel.value = String(state.loader_id);
      // If the saved loader_id no longer exists, clear it.
      if (loaderSel.value !== String(state.loader_id)) {
        state.loader_id = null;
        writeBack();
      }
    }
    // 0-based internal → 1-based UI display.
    if (state.slot != null) slotInp.value = String(state.slot + 1);
  }

  function renderTargetVisibility() {
    const show = state.destination !== "output";
    tgtRow.style.display = show ? "" : "none";
  }

  function writeBack() {
    tgtWidget.value = JSON.stringify(state);
    if (tgtWidget.callback) tgtWidget.callback(tgtWidget.value);
  }

  populateLoaders();
  renderTargetVisibility();
  // Re-scan loaders shortly after mount in case the graph hasn't fully settled.
  setTimeout(populateLoaders, 200);

  // Workflow restore — re-read tgtWidget after ComfyUI rehydrates widget values.
  const origOnConfigure = node.onConfigure;
  node.onConfigure = function () {
    const r = origOnConfigure?.apply(this, arguments);
    loadStateFromWidget();
    destSel.value = state.destination;
    populateLoaders();
    renderTargetVisibility();
    return r;
  };
}
