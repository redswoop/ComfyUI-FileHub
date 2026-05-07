// One-shot stylesheet injection. Imported and called once by filehub.js.

let _injected = false;

export function injectStyles() {
  if (_injected) return;
  _injected = true;
  const css = `
    .fh-root { display:flex; flex-direction:column; gap:6px; padding:6px; font:11px sans-serif; color:#bbb; box-sizing:border-box; width:100%; }
    .fh-tabs { display:flex; gap:4px; align-items:center; }
    .fh-tab { background:#2a2a2a; border:1px solid #444; color:#aaa; border-radius:4px; padding:3px 9px; cursor:pointer; font:11px sans-serif; }
    .fh-tab:hover { border-color:#46b4e6; color:#fff; }
    .fh-tab.active { border-color:#46b4e6; color:#46b4e6; background:#1f2a30; }
    .fh-spacer { flex:1; }
    .fh-icon-btn { background:#2a2a2a; border:1px solid #444; color:#aaa; border-radius:4px; width:24px; height:22px; cursor:pointer; font:11px sans-serif; padding:0; }
    .fh-icon-btn:hover { border-color:#46b4e6; color:#fff; }
    .fh-section-label { font-size:10px; color:#888; text-transform:uppercase; letter-spacing:0.05em; margin-top:2px; }
    .fh-strip { display:flex; gap:4px; flex-wrap:wrap; }
    .fh-slot { position:relative; width:64px; height:64px; border:1px dashed #444; border-radius:4px; background:#1a1a1a; cursor:pointer; overflow:hidden; flex:0 0 auto; }
    .fh-slot.filled { border-style:solid; }
    .fh-slot.active { border-color:#46b4e6; box-shadow:0 0 0 1px #46b4e6 inset; }
    .fh-slot.dragover { border-color:#e6a346; background:#2a2418; }
    .fh-slot img { width:100%; height:100%; object-fit:cover; display:block; }
    .fh-slot .fh-slot-num { position:absolute; top:2px; left:3px; font-size:9px; color:#888; background:#000a; padding:1px 3px; border-radius:2px; pointer-events:none; }
    .fh-slot .fh-slot-x { position:absolute; top:2px; right:2px; width:14px; height:14px; line-height:14px; text-align:center; font-size:11px; color:#aaa; background:#000a; border-radius:50%; cursor:pointer; display:none; }
    .fh-slot.filled:hover .fh-slot-x { display:block; }
    .fh-slot.empty .fh-slot-num { color:#555; }
    .fh-slot .fh-slot-icon { position:absolute; bottom:2px; right:3px; font-size:9px; background:#000a; color:#ddd; padding:1px 3px; border-radius:2px; pointer-events:none; }
    .fh-recent { width:48px; height:48px; }
    .fh-active-name { font-size:10px; color:#aaa; padding:2px 4px; background:#1a1a1a; border-radius:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .fh-row { display:flex; gap:6px; align-items:center; }
    .fh-saver-row { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
    .fh-saver-row select, .fh-saver-row input { background:#2a2a2a; border:1px solid #444; color:#bbb; border-radius:3px; padding:2px 6px; font:11px sans-serif; }
    .fh-saver-row select:focus, .fh-saver-row input:focus { border-color:#46b4e6; outline:none; }

    /* Modal */
    .fh-modal-bg { position:fixed; inset:0; background:#000a; z-index:9999; display:flex; align-items:center; justify-content:center; }
    .fh-modal { background:#222; border:1px solid #444; border-radius:6px; max-width:80vw; max-height:80vh; min-width:520px; display:flex; flex-direction:column; overflow:hidden; }
    .fh-modal-head { padding:8px 12px; border-bottom:1px solid #333; display:flex; align-items:center; gap:8px; }
    .fh-modal-head h3 { margin:0; font:14px sans-serif; color:#ddd; }
    .fh-modal-body { padding:8px 12px; overflow:auto; flex:1; }
    .fh-modal-foot { padding:8px 12px; border-top:1px solid #333; display:flex; gap:8px; justify-content:flex-end; }
    .fh-modal input, .fh-modal select, .fh-modal button { background:#2a2a2a; border:1px solid #444; color:#bbb; border-radius:3px; padding:3px 8px; font:11px sans-serif; }
    .fh-modal button { cursor:pointer; }
    .fh-modal button.primary { background:#46b4e6; color:#000; border-color:#46b4e6; }
    .fh-modal button:hover { border-color:#46b4e6; }
    .fh-grid { display:grid; grid-template-columns:repeat(auto-fill, 96px); gap:6px; }
    .fh-grid-item { width:96px; height:96px; position:relative; border:1px solid #444; border-radius:3px; cursor:pointer; overflow:hidden; background:#1a1a1a; }
    .fh-grid-item.selected { border-color:#46b4e6; box-shadow:0 0 0 1px #46b4e6 inset; }
    .fh-grid-item img { width:100%; height:100%; object-fit:cover; display:block; }
    .fh-grid-item .fh-grid-name { position:absolute; bottom:0; left:0; right:0; font-size:9px; color:#ddd; background:#000c; padding:2px 4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none; }
  `;
  const style = document.createElement("style");
  style.id = "filehub-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
