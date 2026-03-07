import { Application, Container, Graphics } from 'pixi.js'
import type { RenderState, Vec2 } from './types'

interface SceneOptions {
  container: HTMLElement
}

interface DrawSettings {
  speed: number
  showCircles: boolean
}

const BACKGROUND_COLOR = 0xffffff
const ARM_COLORS = [0x16a34a, 0xdc2626] as const
const REFERENCE_COLOR = 0xfacc15
const TRAIL_COLOR = 0x000000

export class FourierScene {
  private readonly host: HTMLElement
  private readonly world = new Container()
  private readonly referenceLayer = new Graphics()
  private readonly trailLayer = new Graphics()
  private readonly epicycleLayer = new Graphics()
  private readonly eyeLayer = new Graphics()

  private app: Application | null = null
  private animationTime = 0
  private previousTime = 0
  private trailLocked = false
  private trail: Vec2[] = []
  private state: RenderState = {
    orderedPoints: [],
    referencePoints: [],
    harmonics: [],
    origin: [0, 0],
  }

  private drawSettings: DrawSettings = {
    speed: 0.005,
    showCircles: true,
  }

  private targetZoom = 1
  private currentZoom = 1
  private cameraFocus: Vec2 = [0, 0]

  constructor(options: SceneOptions) {
    this.host = options.container
    void this.initialize()
  }

  private async initialize() {
    const app = new Application()

    try {
      await app.init({
        resizeTo: this.host,
        background: BACKGROUND_COLOR,
        antialias: true,
        preference: 'webgpu',
      })
    } catch {
      await app.init({
        resizeTo: this.host,
        background: BACKGROUND_COLOR,
        antialias: true,
        preference: 'webgl',
      })
    }

    this.app = app
    this.host.appendChild(app.canvas)
    this.world.addChild(this.referenceLayer, this.trailLayer, this.epicycleLayer, this.eyeLayer)
    app.stage.addChild(this.world)
    app.ticker.add((ticker) => this.render(ticker.deltaMS / 1000))
    this.applyCamera(true)
    window.addEventListener('resize', this.resize)
  }

  destroy() {
    window.removeEventListener('resize', this.resize)
    this.app?.destroy(true, { children: true, texture: true })
  }

  setState(nextState: RenderState) {
    this.state = nextState
    this.animationTime = 0
    this.previousTime = 0
    this.trailLocked = false
    this.trail = []
    this.cameraFocus = [0, 0]
    this.targetZoom = 1
    this.currentZoom = 1
    this.redrawReference()
    this.applyCamera(true)
  }

  clear() {
    this.setState({ orderedPoints: [], referencePoints: [], harmonics: [], origin: [0, 0] })
    this.referenceLayer.clear()
    this.trailLayer.clear()
    this.epicycleLayer.clear()
    this.eyeLayer.clear()
  }

  updateSettings(nextSettings: Partial<DrawSettings>) {
    this.drawSettings = { ...this.drawSettings, ...nextSettings }
  }

  adjustZoom(deltaY: number) {
    const intensity = Math.min(0.32, Math.abs(deltaY) * 0.0012)
    const factor = deltaY < 0 ? 1 + intensity : 1 / (1 + intensity)
    const baseZoom = this.targetZoom <= 1.001 ? 1 : this.targetZoom
    this.targetZoom = Math.min(960, Math.max(1, baseZoom * factor))
  }

  resetZoom() {
    this.targetZoom = 1
  }

  private readonly resize = () => {
    this.applyCamera(true)
  }

  private zoomWidth(baseWidth: number, minWidth: number, power = 1.12) {
    return Math.max(minWidth, baseWidth / Math.pow(Math.max(1, this.currentZoom), power))
  }

  private applyCamera(force: boolean) {
    const hostWidth = this.host.clientWidth || window.innerWidth || 1
    const hostHeight = this.host.clientHeight || window.innerHeight || 1

    if (force) {
      this.currentZoom = this.targetZoom
    } else {
      this.currentZoom += (this.targetZoom - this.currentZoom) * 0.18
      if (Math.abs(this.targetZoom - this.currentZoom) < 0.001) {
        this.currentZoom = this.targetZoom
      }
    }

    const followMode = this.currentZoom > 1.001
    const targetX = followMode
      ? hostWidth / 2 - this.currentZoom * this.cameraFocus[0]
      : this.state.origin[0]
    const targetY = followMode
      ? hostHeight / 2 - this.currentZoom * this.cameraFocus[1]
      : this.state.origin[1]

    this.world.scale.set(this.currentZoom)
    if (force) {
      this.world.position.set(targetX, targetY)
      return
    }

    this.world.position.set(
      this.world.position.x + (targetX - this.world.position.x) * 0.18,
      this.world.position.y + (targetY - this.world.position.y) * 0.18,
    )
  }

  private redrawReference() {
    this.referenceLayer.clear()
    if (this.state.referencePoints.length < 2) {
      return
    }

    const [startX, startY] = this.state.referencePoints[0]
    this.referenceLayer.moveTo(startX, startY)
    for (let index = 1; index < this.state.referencePoints.length; index += 1) {
      const [x, y] = this.state.referencePoints[index]
      this.referenceLayer.lineTo(x, y)
    }

    this.referenceLayer.stroke({
      color: REFERENCE_COLOR,
      width: 0.95,
      alpha: 0.9,
    })
  }

  private armWidth(length: number, isBase: boolean) {
    const baseWidth = isBase ? 4.8 : 3.2
    const minWidth = isBase ? 0.012 : 0.008
    const normalized = 1 - Math.exp(-length / 24)
    const weighted = (isBase ? 0.32 : 0.11) + baseWidth * normalized * normalized
    return this.zoomWidth(weighted, minWidth, 1.2)
  }

  private drawGooglyEyes(x: number, y: number, lookDx: number, lookDy: number) {
    const eyeRadius = 0.26
    const pupilRadius = 0.08
    const length = Math.hypot(lookDx, lookDy) || 1
    const ux = lookDx / length
    const uy = lookDy / length
    const px = -uy
    const py = ux
    const forwardOffset = -0.22
    const spreadOffset = 0.22
    const pupilOffset = 0.05

    const leftEyeX = x - px * spreadOffset + ux * forwardOffset
    const leftEyeY = y - py * spreadOffset + uy * forwardOffset
    const rightEyeX = x + px * spreadOffset + ux * forwardOffset
    const rightEyeY = y + py * spreadOffset + uy * forwardOffset

    this.eyeLayer.circle(leftEyeX, leftEyeY, eyeRadius)
    this.eyeLayer.fill(0xffffff)
    this.eyeLayer.stroke({ color: 0x000000, width: 0.08, alpha: 1 })

    this.eyeLayer.circle(rightEyeX, rightEyeY, eyeRadius)
    this.eyeLayer.fill(0xffffff)
    this.eyeLayer.stroke({ color: 0x000000, width: 0.08, alpha: 1 })

    this.eyeLayer.circle(leftEyeX + ux * pupilOffset, leftEyeY + uy * pupilOffset, pupilRadius)
    this.eyeLayer.fill(0x000000)

    this.eyeLayer.circle(rightEyeX + ux * pupilOffset, rightEyeY + uy * pupilOffset, pupilRadius)
    this.eyeLayer.fill(0x000000)
  }

  private drawArmVector(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    isBase: boolean,
    color: number,
  ) {
    const dx = endX - startX
    const dy = endY - startY
    const length = Math.hypot(dx, dy)
    if (length === 0) {
      return
    }

    const width = this.armWidth(length, isBase)
    this.epicycleLayer.moveTo(startX, startY)
    this.epicycleLayer.lineTo(endX, endY)
    this.epicycleLayer.stroke({ color, width, alpha: 1 })

    const arrowLength = this.zoomWidth(Math.min(8.5, 0.7 + length * 0.16), 0.08, 1.08)
    const arrowSpread = arrowLength * 0.34
    const ux = dx / length
    const uy = dy / length
    const px = -uy
    const py = ux

    const leftX = endX - ux * arrowLength + px * arrowSpread
    const leftY = endY - uy * arrowLength + py * arrowSpread
    const rightX = endX - ux * arrowLength - px * arrowSpread
    const rightY = endY - uy * arrowLength - py * arrowSpread

    this.epicycleLayer.moveTo(leftX, leftY)
    this.epicycleLayer.lineTo(endX, endY)
    this.epicycleLayer.lineTo(rightX, rightY)
    this.epicycleLayer.stroke({ color, width: this.zoomWidth(width * 0.92, 0.012, 1.04), alpha: 1 })
  }

  private render(deltaSeconds: number) {
    if (!this.app || !this.state.harmonics.length) {
      return
    }

    this.previousTime = this.animationTime
    this.animationTime = (this.animationTime + deltaSeconds * this.drawSettings.speed) % 1
    if (this.previousTime > this.animationTime && this.trail.length > this.state.orderedPoints.length / 3) {
      this.trailLocked = true
    }

    this.redrawReference()
    this.epicycleLayer.clear()

    let x = 0
    let y = 0

    for (const [harmonicIndex, harmonic] of this.state.harmonics.entries()) {
      const previousX = x
      const previousY = y
      const angle = Math.PI * 2 * harmonic.frequency * this.animationTime + harmonic.phase
      x += harmonic.amplitude * Math.cos(angle)
      y += harmonic.amplitude * Math.sin(angle)

      const color = ARM_COLORS[harmonicIndex % ARM_COLORS.length]

      if (this.drawSettings.showCircles && harmonic.amplitude > 0.75) {
        this.epicycleLayer.circle(previousX, previousY, harmonic.amplitude)
        this.epicycleLayer.stroke({
          color,
          width: this.zoomWidth(0.52, 0.008, 1.2),
          alpha: 0.45,
        })
      }

      this.drawArmVector(previousX, previousY, x, y, harmonic.frequency === 0, color)
    }

    this.cameraFocus = [x, y]
    this.applyCamera(false)

    const lastTrailPoint = this.trail[this.trail.length - 1]
    const eyeDx = lastTrailPoint ? x - lastTrailPoint[0] : 1
    const eyeDy = lastTrailPoint ? y - lastTrailPoint[1] : 0

    if (!this.trailLocked) {
      const last = this.trail[this.trail.length - 1]
      if (!last || Math.hypot(last[0] - x, last[1] - y) > 0.1) {
        this.trail.push([x, y])
      }
    }

    this.trailLayer.clear()
    this.eyeLayer.clear()
    if (this.trail.length > 1) {
      const [startX, startY] = this.trail[0]
      this.trailLayer.moveTo(startX, startY)
      for (let index = 1; index < this.trail.length; index += 1) {
        const [trailX, trailY] = this.trail[index]
        this.trailLayer.lineTo(trailX, trailY)
      }
      this.trailLayer.stroke({
        color: TRAIL_COLOR,
        width: 1.05,
        alpha: 1,
      })
    }

    this.drawGooglyEyes(x, y, eyeDx, eyeDy)
  }
}
