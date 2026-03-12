import { Application, Container, Graphics } from "https://cdn.jsdelivr.net/npm/pixi.js@8.3.4/+esm";

const BACKGROUND_COLOR = 0xffffff;
const ARM_COLORS = [0x16a50a, 0xdc2826];
const REFERENCE_COLOR = 0xfac545;
const TRAIL_COLOR = 0x000000;
const MAX_ZOOM = 122.3;
const TRAIL_BACKOFF = 4;
const DEVICE_RESOLUTION = Math.min(window.devicePixelRatio || 1, 4);
const MARKER_GAP = 10;

export class FourierStage {
  host;
  world = new Container();
  referenceLayer = new Graphics();
  trailLayer = new Graphics();
  epicycleLayer = new Graphics();
  eyeLayer = new Graphics();
  app = null;
  animationTime = 0;
  tracePoints = [];
  state = emptyState();
  drawSettings = { speed: 0.005, showCircles: true };
  targetZoom = 1;
  currentZoom = 1;
  cameraFocus = [0, 0];

  constructor({ container }) {
    this.host = container;
  }

  async initialize() {
    const app = new Application();

    try {
      await app.init({
        resizeTo: this.host,
        background: BACKGROUND_COLOR,
        antialias: true,
        autoDensity: true,
        resolution: DEVICE_RESOLUTION,
        preference: "webgpu",
      });
    } catch {
      await app.init({
        resizeTo: this.host,
        background: BACKGROUND_COLOR,
        antialias: true,
        autoDensity: true,
        resolution: DEVICE_RESOLUTION,
        preference: "webgl",
      });
    }

    this.app = app;
    this.host.appendChild(app.canvas);
    this.world.addChild(this.referenceLayer, this.trailLayer, this.epicycleLayer, this.eyeLayer);
    app.stage.addChild(this.world);
    app.ticker.add((ticker) => this.render(ticker.deltaMS / 1000));
    this.applyCamera(true);
    window.addEventListener("resize", this.resize);
  }

  destroy() {
    window.removeEventListener("resize", this.resize);
    this.app?.destroy(true, { children: true, texture: true });
  }

  setState(state) {
    this.state = state;
    this.animationTime = 0;
    this.tracePoints = this.buildTracePoints();
    this.cameraFocus = [0, 0];
    this.targetZoom = 1;
    this.currentZoom = 1;
    this.redrawReference();
    this.applyCamera(true);
  }

  clear() {
    this.setState(emptyState());
    this.referenceLayer.clear();
    this.trailLayer.clear();
    this.epicycleLayer.clear();
    this.eyeLayer.clear();
  }

  updateSettings(settings) {
    this.drawSettings = { ...this.drawSettings, ...settings };
  }

  getCurrentZoom() {
    return this.currentZoom;
  }

  adjustZoom(deltaY) {
    const step = Math.min(0.32, Math.abs(deltaY) * 0.0012);
    const factor = deltaY < 0 ? 1 + step : 1 / (1 + step);
    const baseZoom = this.targetZoom <= 1.001 ? 1 : this.targetZoom;

    this.targetZoom = Math.min(MAX_ZOOM, Math.max(1, baseZoom * factor));
  }

  resetZoom() {
    this.targetZoom = 1;
    this.currentZoom = 1;
    this.applyCamera(true);
  }

  resize = () => {
    this.applyCamera(true);
  };

  zoomWidth(size, minimum, exponent = 1.12) {
    return Math.max(minimum, size / Math.pow(Math.max(1, this.currentZoom), exponent));
  }

  applyCamera(force) {
    const width = this.host.clientWidth || window.innerWidth || 1;
    const height = this.host.clientHeight || window.innerHeight || 1;

    if (force) {
      this.currentZoom = this.targetZoom;
    } else {
      this.currentZoom += (this.targetZoom - this.currentZoom) * 0.18;
      if (Math.abs(this.targetZoom - this.currentZoom) < 0.001) {
        this.currentZoom = this.targetZoom;
      }
    }

    const zoomed = this.currentZoom > 1.001;
    const targetX = zoomed ? width / 2 - this.currentZoom * this.cameraFocus[0] : this.state.origin[0];
    const targetY = zoomed ? height / 2 - this.currentZoom * this.cameraFocus[1] : this.state.origin[1];

    this.world.scale.set(this.currentZoom);

    if (force) {
      this.world.position.set(targetX, targetY);
      return;
    }

    this.world.position.set(
      this.world.position.x + (targetX - this.world.position.x) * 0.18,
      this.world.position.y + (targetY - this.world.position.y) * 0.18,
    );
  }

  redrawReference() {
    this.referenceLayer.clear();

    if (this.state.referencePoints.length < 2) {
      return;
    }

    const [firstX, firstY] = this.state.referencePoints[0];
    this.referenceLayer.moveTo(firstX, firstY);

    for (let index = 1; index < this.state.referencePoints.length; index += 1) {
      const [x, y] = this.state.referencePoints[index];
      this.referenceLayer.lineTo(x, y);
    }

    this.referenceLayer.stroke({ color: REFERENCE_COLOR, width: 0.95, alpha: 0.9 });
  }

  buildTracePoints() {
    if (!this.state.harmonics.length) {
      return [];
    }

    const sampleCount = Math.max(1024, this.state.orderedPoints.length * 2);
    const points = [];

    for (let index = 0; index < sampleCount; index += 1) {
      const t = index / sampleCount;
      let x = 0;
      let y = 0;

      for (const harmonic of this.state.harmonics) {
        const angle = Math.PI * 2 * harmonic.frequency * t + harmonic.phase;
        x += harmonic.amplitude * Math.cos(angle);
        y += harmonic.amplitude * Math.sin(angle);
      }

      points.push([x, y]);
    }

    return points;
  }

  samplePathPoint(points, t) {
    if (!points.length) {
      return [0, 0];
    }

    if (points.length === 1) {
      return points[0];
    }

    const wrapped = Math.max(0, Math.min(0.999999, t)) * points.length;
    const index = Math.floor(wrapped) % points.length;
    const nextIndex = (index + 1) % points.length;
    const mix = wrapped - Math.floor(wrapped);
    const [ax, ay] = points[index];
    const [bx, by] = points[nextIndex];

    return [ax + (bx - ax) * mix, ay + (by - ay) * mix];
  }

  buildVisibleTrail(t) {
    const points = this.tracePoints.length > 1 ? this.tracePoints : this.state.orderedPoints;

    if (points.length < 2) {
      return {
        pathPoints: [],
        visiblePointCount: 0,
        markerPoint: [0, 0],
        curvePoint: [0, 0],
      };
    }

    const normalizedTime = Math.max(0, Math.min(0.999999, t));
    const targetIndex = normalizedTime * points.length;
    const wholeIndex = Math.floor(targetIndex);
    const curvePoint = this.samplePathPoint(points, normalizedTime);
    const pathPoints = [points[0]];

    for (let index = 1; index <= Math.min(wholeIndex, points.length - 1); index += 1) {
      pathPoints.push(points[index]);
    }

    pathPoints.push(curvePoint);

    let pathLength = 0;
    for (let index = 1; index < pathPoints.length; index += 1) {
      const [ax, ay] = pathPoints[index - 1];
      const [bx, by] = pathPoints[index];
      pathLength += Math.hypot(bx - ax, by - ay);
    }

    let remaining = Math.min(TRAIL_BACKOFF, Math.max(0, pathLength - MARKER_GAP));
    let visiblePointCount = pathPoints.length - 1;
    let markerPoint = pathPoints[visiblePointCount];

    while (visiblePointCount > 0 && remaining > 0) {
      const [ax, ay] = pathPoints[visiblePointCount];
      const [bx, by] = pathPoints[visiblePointCount - 1];
      const dx = ax - bx;
      const dy = ay - by;
      const segmentLength = Math.hypot(dx, dy);

      if (segmentLength >= remaining && segmentLength > 0) {
        const ratio = remaining / segmentLength;
        markerPoint = [ax - dx * ratio, ay - dy * ratio];
        remaining = 0;
        break;
      }

      remaining -= segmentLength;
      visiblePointCount -= 1;
      markerPoint = pathPoints[visiblePointCount];
    }

    return { pathPoints, visiblePointCount, markerPoint, curvePoint };
  }

  armWidth(length, isPrimaryArm) {
    const growth = isPrimaryArm ? 4.8 : 3.3;
    const minimum = isPrimaryArm ? 0.018 : 0.011;
    const eased = 1 - Math.exp(-length / 24);
    const size = (isPrimaryArm ? 0.34 : 0.13) + growth * eased * eased;

    return this.zoomWidth(size, minimum, 0.84);
  }

  arrowHeadLength(length) {
    const baseSize = this.zoomWidth(Math.min(8.9, 0.85 + length * 0.18), 0.18, 0.74);
    const highZoom = Math.max(0, this.currentZoom - 6);
    const damping = 1 + Math.pow(highZoom, 0.85) * 0.22;

    return Math.max(0.1, baseSize / damping);
  }

  drawTipDot(x, y) {
    this.eyeLayer.circle(x, y, 0.32);
    this.eyeLayer.fill({ color: 0x000000, alpha: 0.05 });
    this.eyeLayer.circle(x, y, 0.16);
    this.eyeLayer.fill({ color: 0x000000, alpha: 0.11 });
    this.eyeLayer.circle(x, y, 0.055);
    this.eyeLayer.fill(0x000000);
  }

  drawGooglyEyes(x, y, vx, vy) {
    const length = Math.hypot(vx, vy) || 1;
    const dx = vx / length;
    const dy = vy / length;
    const nx = -dy;
    const ny = dx;
    const forwardOffset = -0.62;
    const sideOffset = 0.22;
    const pupilOffset = 0.05;

    const leftX = x - nx * sideOffset + dx * forwardOffset;
    const leftY = y - ny * sideOffset + dy * forwardOffset;
    const rightX = x + nx * sideOffset + dx * forwardOffset;
    const rightY = y + ny * sideOffset + dy * forwardOffset;

    this.eyeLayer.circle(leftX, leftY, 0.26);
    this.eyeLayer.fill(0xffffff);
    this.eyeLayer.stroke({ color: 0x000000, width: 0.08, alpha: 1 });

    this.eyeLayer.circle(rightX, rightY, 0.26);
    this.eyeLayer.fill(0xffffff);
    this.eyeLayer.stroke({ color: 0x000000, width: 0.08, alpha: 1 });

    this.eyeLayer.circle(leftX + dx * pupilOffset, leftY + dy * pupilOffset, 0.08);
    this.eyeLayer.fill(0x000000);
    this.eyeLayer.circle(rightX + dx * pupilOffset, rightY + dy * pupilOffset, 0.08);
    this.eyeLayer.fill(0x000000);
  }

  drawArmVector(fromX, fromY, toX, toY, isPrimaryArm, color) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);

    if (length === 0) {
      return;
    }

    const shaftWidth = this.armWidth(length, isPrimaryArm);
    this.epicycleLayer.moveTo(fromX, fromY);
    this.epicycleLayer.lineTo(toX, toY);
    this.epicycleLayer.stroke({
      color,
      width: shaftWidth,
      alpha: 1,
      cap: "round",
      join: "round",
      miterLimit: 1,
    });

    const headLength = this.arrowHeadLength(length);
    const headHalfWidth = headLength * 0.46;
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const leftX = toX - ux * headLength + nx * headHalfWidth;
    const leftY = toY - uy * headLength + ny * headHalfWidth;
    const rightX = toX - ux * headLength - nx * headHalfWidth;
    const rightY = toY - uy * headLength - ny * headHalfWidth;

    this.epicycleLayer.moveTo(leftX, leftY);
    this.epicycleLayer.lineTo(toX, toY);
    this.epicycleLayer.lineTo(rightX, rightY);
    this.epicycleLayer.lineTo(leftX, leftY);
    this.epicycleLayer.fill({ color, alpha: 1 });
  }

  render(deltaSeconds) {
    if (!this.app || !this.state.harmonics.length) {
      return;
    }

    this.animationTime = (this.animationTime + deltaSeconds * this.drawSettings.speed) % 1;
    this.redrawReference();
    this.epicycleLayer.clear();

    let x = 0;
    let y = 0;

    for (const [index, harmonic] of this.state.harmonics.entries()) {
      const startX = x;
      const startY = y;
      const angle = Math.PI * 2 * harmonic.frequency * this.animationTime + harmonic.phase;

      x += harmonic.amplitude * Math.cos(angle);
      y += harmonic.amplitude * Math.sin(angle);

      const color = ARM_COLORS[index % ARM_COLORS.length];

      if (this.drawSettings.showCircles && harmonic.amplitude > 0.75) {
        this.epicycleLayer.circle(startX, startY, harmonic.amplitude);
        this.epicycleLayer.stroke({
          color,
          width: this.zoomWidth(0.72, 0.012, 1.02),
          alpha: 0.55,
          cap: "round",
          join: "round",
          miterLimit: 1,
          alignment: 0.5,
        });
      }

      this.drawArmVector(startX, startY, x, y, harmonic.frequency === 0, color);
    }

    this.cameraFocus = [x, y];
    this.applyCamera(false);

    const trail = this.buildVisibleTrail(this.animationTime);
    const markerDx = x - trail.markerPoint[0];
    const markerDy = y - trail.markerPoint[1];
    const lookAheadPoint = this.samplePathPoint(
      this.tracePoints.length > 1 ? this.tracePoints : this.state.orderedPoints,
      Math.min(
        0.999999,
        this.animationTime + 1 / Math.max(128, this.tracePoints.length || this.state.orderedPoints.length || 128),
      ),
    );
    const eyeDx = Math.hypot(markerDx, markerDy) > 0.001 ? markerDx : lookAheadPoint[0] - trail.curvePoint[0];
    const eyeDy = Math.hypot(markerDx, markerDy) > 0.001 ? markerDy : lookAheadPoint[1] - trail.curvePoint[1];

    this.trailLayer.clear();
    this.eyeLayer.clear();

    if (trail.pathPoints.length > 1) {
      const [firstX, firstY] = trail.pathPoints[0];
      this.trailLayer.moveTo(firstX, firstY);

      for (let index = 1; index < trail.visiblePointCount; index += 1) {
        const [pointX, pointY] = trail.pathPoints[index];
        this.trailLayer.lineTo(pointX, pointY);
      }

      this.trailLayer.lineTo(trail.markerPoint[0], trail.markerPoint[1]);
      this.trailLayer.stroke({
        color: TRAIL_COLOR,
        width: 1.05,
        alpha: 1,
        cap: "round",
        join: "round",
        miterLimit: 1,
      });
    }

    this.drawGooglyEyes(trail.markerPoint[0], trail.markerPoint[1], eyeDx, eyeDy);
    this.drawTipDot(x, y);
  }
}

function emptyState() {
  return {
    orderedPoints: [],
    referencePoints: [],
    harmonics: [],
    origin: [0, 0],
  };
}
