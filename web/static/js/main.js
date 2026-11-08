import { load } from "./api.js";
import { initControls } from "./controls.js";

function start() {
  initControls();
  load(false);
  setInterval(() => load(false), 60000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

