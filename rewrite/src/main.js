import { FourierStage } from "./FourierStage.js";
import { buildDemoPoints } from "./traceDemo.js";

const BASE_SPEED = 0.005;
const DEFAULT_WORKER_CONFIG = {
  sampleCount: 1800,
  harmonicCount: 420,
  smoothingRadius: 2,
};

function requireElement(selector) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

function emptyState() {
  return {
    orderedPoints: [],
    referencePoints: [],
    harmonics: [],
    origin: [0, 0],
  };
}

const appRoot = requireElement("#app");
appRoot.innerHTML = `
  <div class="shell">
    <div id="stage" class="stage"></div>
    <div class="zoom-hint" aria-hidden="true">
      <div class="zoom-hint-row">
        <div class="zoom-hint-text">Scroll to zoom <span class="zoom-value">1.00x</span></div>
        <div class="zoom-hint-actions">
          <span class="hint-chip"><span class="hint-key">P</span><span class="hint-label">slow</span></span>
          <span class="hint-chip"><span class="hint-key">C</span><span class="hint-label">circles</span></span>
        </div>
      </div>
    </div>
  </div>
`;

const stageElement = requireElement("#stage");
const zoomValueElement = requireElement(".zoom-value");
const stage = new FourierStage({ container: stageElement });
const worker = new Worker(new URL("./fourier.worker.js", import.meta.url), { type: "module" });

let requestId = 0;
let state = "loading";
let currentState = emptyState();
let slowMode = false;
let showCircles = true;

await stage.initialize();
applySettings();
updateZoomLabel();
animateZoomLabel();
reloadDemo();

worker.onmessage = (event) => {
  const payload = event.data;

  if (payload.id !== requestId) {
    return;
  }

  if (!payload.ok) {
    console.error(payload.error);
    state = "loading";
    return;
  }

  currentState = {
    orderedPoints: payload.orderedPoints,
    referencePoints: payload.referencePoints,
    harmonics: payload.harmonics,
    origin: payload.origin,
  };

  state = "animating";
  stage.setState(currentState);
  applySettings();
  updateZoomLabel();
};

window.addEventListener(
  "wheel",
  (event) => {
    if (state !== "animating") {
      return;
    }

    event.preventDefault();
    stage.adjustZoom(event.deltaY);
    updateZoomLabel();
  },
  { passive: false },
);

window.addEventListener("resize", () => {
  if (state !== "processing") {
    reloadDemo();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "p" || event.key === "P") {
    slowMode = !slowMode;
    applySettings();
    return;
  }

  if (event.key === "c" || event.key === "C") {
    showCircles = !showCircles;
    applySettings();
  }
});

window.addEventListener("beforeunload", () => {
  worker.terminate();
  stage.destroy();
});

function updateZoomLabel() {
  const zoom = stage.getCurrentZoom();
  zoomValueElement.textContent = `${zoom < 10 ? zoom.toFixed(2) : zoom.toFixed(1)}x`;
}

function animateZoomLabel() {
  updateZoomLabel();
  requestAnimationFrame(animateZoomLabel);
}

function applySettings() {
  stage.updateSettings({
    speed: slowMode ? BASE_SPEED / 10 : BASE_SPEED,
    showCircles,
  });
}

function beginReload() {
  state = "processing";
  stage.clear();
  applySettings();
  stage.resetZoom();
  updateZoomLabel();
}

async function reloadDemo() {
  beginReload();

  try {
    const points = await buildDemoPoints(window.innerWidth, window.innerHeight);
    worker.postMessage({
      id: ++requestId,
      points,
      ...DEFAULT_WORKER_CONFIG,
    });
  } catch (error) {
    console.error(error);
    state = "loading";
  }
}
