// Browser modal (multi-select files to pin) and pinset CRUD modal.

const PLACEHOLDER_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="#2a2a2a"/><text x="48" y="56" text-anchor="middle" font-family="sans-serif" font-size="36" fill="#666">?</text></svg>`,
  );

function thumbUrl(slot) {
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

function makeModal(title) {
  const bg = document.createElement("div");
  bg.className = "fh-modal-bg";
  const modal = document.createElement("div");
  modal.className = "fh-modal";
  bg.appendChild(modal);

  const head = document.createElement("div");
  head.className = "fh-modal-head";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  head.appendChild(h3);

  const body = document.createElement("div");
  body.className = "fh-modal-body";

  const foot = document.createElement("div");
  foot.className = "fh-modal-foot";

  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);

  document.body.appendChild(bg);

  function close() {
    bg.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  bg.addEventListener("click", (e) => {
    if (e.target === bg) close();
  });

  return { bg, modal, head, body, foot, close };
}

// --- Browser modal ----------------------------------------------------------

export function openBrowserModal({ defaultType = "input", onPick }) {
  const { head, body, foot, close } = makeModal("Browse files");

  let type = defaultType;
  let subfolder = "";
  let sort = "mtime";
  let search = "";
  let files = [];
  let subfolders = [];
  let total = 0;
  let offset = 0;
  const PAGE = 200;
  const selected = new Set(); // index-into-files

  // Header controls
  const tabs = document.createElement("div");
  tabs.style.cssText = "display:flex; gap:4px;";
  for (const t of ["input", "output", "temp"]) {
    const b = document.createElement("button");
    b.className = "fh-tab";
    b.textContent = t;
    b.addEventListener("click", () => {
      type = t;
      subfolder = "";
      selected.clear();
      reload();
    });
    tabs.appendChild(b);
    b.dataset.t = t;
  }

  const searchInp = document.createElement("input");
  searchInp.placeholder = "filter…";
  searchInp.style.width = "150px";
  searchInp.addEventListener("input", () => {
    search = searchInp.value.toLowerCase();
    renderGrid();
  });

  const sortSel = document.createElement("select");
  for (const [v, l] of [
    ["mtime", "newest first"],
    ["name", "name"],
  ]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    sortSel.appendChild(o);
  }
  sortSel.value = sort;
  sortSel.addEventListener("change", () => {
    sort = sortSel.value;
    reload();
  });

  head.appendChild(tabs);
  head.appendChild(searchInp);
  head.appendChild(sortSel);

  // Path row (subfolder breadcrumb)
  const pathRow = document.createElement("div");
  pathRow.style.cssText = "padding:4px 12px; font-size:10px; color:#888; border-bottom:1px solid #333;";

  // Sub-grid container
  const grid = document.createElement("div");
  grid.className = "fh-grid";

  body.innerHTML = "";
  body.appendChild(pathRow);
  body.appendChild(grid);

  // Foot
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", close);

  const pin = document.createElement("button");
  pin.className = "primary";
  pin.textContent = "Pin selected";
  pin.addEventListener("click", () => {
    const slots = Array.from(selected)
      .sort((a, b) => a - b)
      .map((i) => ({
        type: files[i].type,
        subfolder: files[i].subfolder || "",
        filename: files[i].name,
      }));
    close();
    onPick?.(slots);
  });

  foot.appendChild(cancel);
  foot.appendChild(pin);

  function renderTabs() {
    for (const b of tabs.children) {
      b.classList.toggle("active", b.dataset.t === type);
    }
  }

  function renderPath() {
    const segs = ["/"];
    if (subfolder) segs.push(subfolder);
    pathRow.textContent = `${type}: ${subfolder || "/"}`;
    pathRow.style.cursor = subfolder ? "pointer" : "default";
    pathRow.onclick = subfolder
      ? () => {
          subfolder = subfolder.split("/").slice(0, -1).join("/");
          selected.clear();
          reload();
        }
      : null;
  }

  function renderGrid() {
    grid.innerHTML = "";
    // Subfolders first
    for (const sf of subfolders) {
      const item = document.createElement("div");
      item.className = "fh-grid-item";
      item.style.background = "#252525";
      item.title = sf;
      item.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:24px;color:#888;">📁</div>`;
      const name = document.createElement("div");
      name.className = "fh-grid-name";
      name.textContent = sf + "/";
      item.appendChild(name);
      item.addEventListener("click", () => {
        subfolder = subfolder ? `${subfolder}/${sf}` : sf;
        selected.clear();
        reload();
      });
      grid.appendChild(item);
    }
    // Files
    files.forEach((f, idx) => {
      if (search && !f.name.toLowerCase().includes(search)) return;
      const item = document.createElement("div");
      item.className = "fh-grid-item";
      if (selected.has(idx)) item.classList.add("selected");
      item.title = `${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
      const img = document.createElement("img");
      img.src = thumbUrl({ type: f.type, subfolder: f.subfolder, filename: f.name });
      img.loading = "lazy";
      img.draggable = false;
      img.onerror = () => (img.src = PLACEHOLDER_SVG);
      item.appendChild(img);
      const name = document.createElement("div");
      name.className = "fh-grid-name";
      name.textContent = f.name;
      item.appendChild(name);
      item.addEventListener("click", (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          if (selected.has(idx)) selected.delete(idx);
          else selected.add(idx);
        } else {
          selected.clear();
          selected.add(idx);
        }
        renderGrid();
      });
      item.addEventListener("dblclick", () => {
        // Quick-pin single
        close();
        onPick?.([{ type: f.type, subfolder: f.subfolder || "", filename: f.name }]);
      });
      grid.appendChild(item);
    });
    if (!subfolders.length && !files.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "grid-column: 1/-1; padding:20px; text-align:center; color:#666;";
      empty.textContent = "(empty)";
      grid.appendChild(empty);
    }
    // Load-more footer
    const shown = files.length;
    if (shown < total) {
      const more = document.createElement("button");
      more.style.cssText = "grid-column:1/-1; margin-top:8px;";
      more.textContent = `Load more (${shown} / ${total})`;
      more.addEventListener("click", async () => {
        more.disabled = true;
        more.textContent = "loading…";
        offset = shown;
        await reload({ append: true });
      });
      grid.appendChild(more);
    } else if (total > 0) {
      const done = document.createElement("div");
      done.style.cssText = "grid-column:1/-1; padding:6px; text-align:center; color:#666; font-size:10px;";
      done.textContent = `${total} files`;
      grid.appendChild(done);
    }
  }

  async function reload({ append = false } = {}) {
    renderTabs();
    renderPath();
    if (!append) {
      grid.innerHTML = `<div style="grid-column:1/-1; padding:20px; text-align:center; color:#666;">loading…</div>`;
      offset = 0;
      files = [];
      subfolders = [];
      total = 0;
    }
    try {
      const params = new URLSearchParams({ type, subfolder, sort, offset: String(offset), limit: String(PAGE) });
      const r = await fetch(`/filehub/list?${params}`);
      if (!r.ok) {
        grid.innerHTML = `<div style="grid-column:1/-1; padding:20px; color:#e66;">error ${r.status}</div>`;
        return;
      }
      const j = await r.json();
      if (append) {
        files = files.concat(j.files || []);
      } else {
        files = j.files || [];
        subfolders = j.subfolders || [];
      }
      total = typeof j.total === "number" ? j.total : files.length;
      renderGrid();
    } catch (e) {
      grid.innerHTML = `<div style="grid-column:1/-1; padding:20px; color:#e66;">${e.message}</div>`;
    }
  }

  reload();
}

// --- Pinset modal -----------------------------------------------------------

export function openPinsetModal({ currentPins, onLoad }) {
  const { head, body, foot, close } = makeModal("Pin sets");

  // Save row
  const saveRow = document.createElement("div");
  saveRow.style.cssText = "display:flex; gap:6px; margin-bottom:12px;";
  const nameInp = document.createElement("input");
  nameInp.placeholder = "name (e.g. edit-faces-A)";
  nameInp.style.flex = "1";
  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.textContent = "Export current pins";
  saveBtn.addEventListener("click", async () => {
    const name = nameInp.value.trim();
    if (!name) return;
    const slots = (currentPins || []).filter(Boolean);
    try {
      const r = await fetch(`/filehub/pinsets/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots }),
      });
      if (r.ok) {
        nameInp.value = "";
        await reloadList();
      } else {
        const j = await r.json().catch(() => ({}));
        alert(`Save failed: ${j.error || r.status}`);
      }
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    }
  });

  saveRow.appendChild(nameInp);
  saveRow.appendChild(saveBtn);

  const list = document.createElement("div");
  list.style.cssText = "display:flex; flex-direction:column; gap:4px;";

  body.innerHTML = "";
  body.appendChild(saveRow);
  body.appendChild(list);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", close);
  foot.appendChild(closeBtn);

  async function reloadList() {
    list.innerHTML = "loading…";
    try {
      const r = await fetch("/filehub/pinsets");
      const j = await r.json();
      const names = j.names || [];
      list.innerHTML = "";
      if (!names.length) {
        list.textContent = "(no saved pin sets)";
        list.style.color = "#666";
        return;
      }
      list.style.color = "";
      for (const n of names) {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex; gap:6px; align-items:center; padding:4px 6px; background:#1a1a1a; border-radius:3px;";
        const label = document.createElement("span");
        label.textContent = n;
        label.style.flex = "1";
        const loadB = document.createElement("button");
        loadB.textContent = "Load";
        loadB.addEventListener("click", async () => {
          const r2 = await fetch(`/filehub/pinsets/${encodeURIComponent(n)}`);
          if (!r2.ok) return alert(`Load failed: ${r2.status}`);
          const j2 = await r2.json();
          close();
          onLoad?.(j2.slots || []);
        });
        const delB = document.createElement("button");
        delB.textContent = "Delete";
        delB.addEventListener("click", async () => {
          if (!confirm(`Delete pin set "${n}"?`)) return;
          await fetch(`/filehub/pinsets/${encodeURIComponent(n)}`, { method: "DELETE" });
          await reloadList();
        });
        row.appendChild(label);
        row.appendChild(loadB);
        row.appendChild(delB);
        list.appendChild(row);
      }
    } catch (e) {
      list.innerHTML = `<span style="color:#e66;">${e.message}</span>`;
    }
  }

  reloadList();
}
