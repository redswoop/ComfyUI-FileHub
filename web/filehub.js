// ComfyUI-FileHub frontend entry. Registers a single extension that mounts
// per-node DOM widgets for FileHubLoader / FileHubSaver.

import { mountLoader } from "./loader-widget.js";
import { mountSaver } from "./saver-widget.js";
import { injectStyles } from "./styles.js";

const { app } = window.comfyAPI.app;

injectStyles();

app.registerExtension({
  name: "FileHub",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name === "FileHubLoader") {
      const orig = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = orig?.apply(this, arguments);
        try {
          mountLoader(this);
        } catch (e) {
          console.error("[FileHub] mountLoader failed", e);
        }
        return r;
      };
    } else if (nodeData?.name === "FileHubSaver") {
      const orig = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = orig?.apply(this, arguments);
        try {
          mountSaver(this);
        } catch (e) {
          console.error("[FileHub] mountSaver failed", e);
        }
        return r;
      };
    }
  },
});
