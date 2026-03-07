import './style.css'
import { loadDemoTrace } from './app/demoTrace'
import { FourierScene } from './app/pixiScene'
import type {
  ProcessStrokeRequest,
  ProcessStrokeResponse,
  ProcessingSettings,
  RenderState,
} from './app/types'

const FIXED_SPEED = 0.005

const DEFAULT_SETTINGS: ProcessingSettings = {
  sampleCount: 720,
  harmonicCount: 220,
  smoothingRadius: 2,
}

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Required element not found: ${selector}`)
  }
  return element
}

function emptyState(): RenderState {
  return {
    orderedPoints: [],
    referencePoints: [],
    harmonics: [],
    origin: [0, 0],
  }
}

const app = getRequiredElement<HTMLDivElement>('#app')

app.innerHTML = `
  <div class="shell">
    <div id="stage" class="stage"></div>
    <div class="zoom-hint" aria-hidden="true">
      <div class="zoom-gesture">
        <div class="zoom-mouse">
          <span class="zoom-mouse-notch"></span>
        </div>
        <div class="zoom-motion">
          <span class="zoom-arrow zoom-arrow--up"></span>
          <span class="zoom-arrow zoom-arrow--down"></span>
        </div>
        <div class="zoom-pulse">
          <span class="zoom-pulse-ring zoom-pulse-ring--one"></span>
          <span class="zoom-pulse-ring zoom-pulse-ring--two"></span>
        </div>
      </div>
      <div class="zoom-label">SCROLL TO ZOOM</div>
    </div>
  </div>
`

const stage = getRequiredElement<HTMLElement>('#stage')
const scene = new FourierScene({ container: stage })
const worker = new Worker(new URL('./workers/fourier.worker.ts', import.meta.url), { type: 'module' })

let latestJobId = 0
let mode: 'loading' | 'processing' | 'animating' = 'loading'
let currentState: RenderState = emptyState()

function beginProcessing() {
  mode = 'processing'
  scene.clear()
  scene.updateSettings({ speed: FIXED_SPEED })
  scene.resetZoom()
}

function submitDemo() {
  beginProcessing()
  void loadDemoTrace(window.innerWidth, window.innerHeight)
    .then((points) => {
      const request: ProcessStrokeRequest = {
        id: ++latestJobId,
        points,
        ...DEFAULT_SETTINGS,
      }
      worker.postMessage(request)
    })
    .catch((error) => {
      console.error(error)
      mode = 'loading'
    })
}

worker.onmessage = (event: MessageEvent<ProcessStrokeResponse>) => {
  const message = event.data
  if (message.id !== latestJobId) {
    return
  }

  if (!message.ok) {
    console.error(message.error)
    mode = 'loading'
    return
  }

  currentState = {
    orderedPoints: message.orderedPoints,
    referencePoints: message.referencePoints,
    harmonics: message.harmonics,
    origin: message.origin,
  }

  mode = 'animating'
  scene.setState(currentState)
  scene.updateSettings({ speed: FIXED_SPEED })
}

window.addEventListener(
  'wheel',
  (event) => {
    if (mode !== 'animating') {
      return
    }

    event.preventDefault()
    scene.adjustZoom(event.deltaY)
  },
  { passive: false },
)

window.addEventListener('resize', () => {
  if (mode !== 'processing') {
    submitDemo()
  }
})

scene.updateSettings({ speed: FIXED_SPEED })
submitDemo()

window.addEventListener('beforeunload', () => {
  worker.terminate()
  scene.destroy()
})
