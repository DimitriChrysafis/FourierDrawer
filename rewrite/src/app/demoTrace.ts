import type { Vec2 } from './types'

const DEMO_IMAGE_URL = '/demo/mona-outline.png'
const MAX_RASTER_SIDE = 520
const THRESHOLD_FLOOR = 170
const THRESHOLD_CEILING = 244
const FIT_WIDTH_RATIO = 0.66
const FIT_HEIGHT_RATIO = 0.84
const MIN_SEGMENT_POINTS = 6
const CONNECT_PENALTY = 14

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]

export async function loadDemoTrace(viewportWidth: number, viewportHeight: number): Promise<Vec2[]> {
  const bitmap = await loadDemoBitmap()
  try {
    const { width, height, mask } = rasterizeLinework(bitmap)
    const skeleton = skeletonize(mask, width, height)
    const segments = extractStrokeSegments(skeleton, width, height)
    if (!segments.length) {
      throw new Error('The demo outline could not be turned into a stroke.')
    }

    const continuous = stitchSegments(segments)
    if (continuous.length < 24) {
      throw new Error('The demo outline did not produce enough ordered points.')
    }

    return fitToViewport(simplifyCollinear(continuous), viewportWidth, viewportHeight)
  } finally {
    bitmap.close()
  }
}

async function loadDemoBitmap() {
  const response = await fetch(DEMO_IMAGE_URL)
  if (!response.ok) {
    throw new Error(`Failed to load demo image: ${response.status}`)
  }

  const blob = await response.blob()
  return createImageBitmap(blob)
}

function rasterizeLinework(bitmap: ImageBitmap) {
  const scale = Math.min(1, MAX_RASTER_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(48, Math.round(bitmap.width * scale))
  const height = Math.max(48, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('Could not create a 2D context for demo tracing.')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.drawImage(bitmap, 0, 0, width, height)

  const imageData = context.getImageData(0, 0, width, height)
  const data = imageData.data
  const luminances = new Uint8Array(width * height)
  const histogram = new Uint32Array(256)

  for (let index = 0, pixelIndex = 0; index < data.length; index += 4, pixelIndex += 1) {
    const alpha = data[index + 3] / 255
    const luminance = Math.round(
      (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) * alpha +
        255 * (1 - alpha),
    )
    luminances[pixelIndex] = luminance
    histogram[luminance] += 1
  }

  const background = histogramPercentile(histogram, 0.985)
  const threshold = clamp(background - 10, THRESHOLD_FLOOR, THRESHOLD_CEILING)
  const mask = new Uint8Array(width * height)

  for (let pixelIndex = 0; pixelIndex < luminances.length; pixelIndex += 1) {
    if (luminances[pixelIndex] <= threshold) {
      mask[pixelIndex] = 1
    }
  }

  pruneIsolatedPixels(mask, width, height)
  bridgeSmallGaps(mask, width, height)
  return { width, height, mask }
}

function histogramPercentile(histogram: Uint32Array, percentile: number) {
  let total = 0
  for (const count of histogram) {
    total += count
  }

  const target = total * percentile
  let running = 0
  for (let value = 0; value < histogram.length; value += 1) {
    running += histogram[value]
    if (running >= target) {
      return value
    }
  }

  return histogram.length - 1
}

function pruneIsolatedPixels(mask: Uint8Array, width: number, height: number) {
  const copy = mask.slice()
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const key = y * width + x
      if (!copy[key]) {
        continue
      }

      let neighbors = 0
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        neighbors += copy[(y + dy) * width + (x + dx)]
      }

      if (neighbors <= 1) {
        mask[key] = 0
      }
    }
  }
}

function bridgeSmallGaps(mask: Uint8Array, width: number, height: number) {
  const additions: number[] = []

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const key = y * width + x
      if (mask[key]) {
        continue
      }

      const left = mask[key - 1]
      const right = mask[key + 1]
      const up = mask[key - width]
      const down = mask[key + width]
      const upLeft = mask[key - width - 1]
      const downRight = mask[key + width + 1]
      const upRight = mask[key - width + 1]
      const downLeft = mask[key + width - 1]

      if ((left && right) || (up && down) || (upLeft && downRight) || (upRight && downLeft)) {
        additions.push(key)
      }
    }
  }

  for (const key of additions) {
    mask[key] = 1
  }
}

function skeletonize(mask: Uint8Array, width: number, height: number) {
  const skeleton = mask.slice()
  let changed = true

  while (changed) {
    changed = false
    const phaseOne = collectThinPixels(skeleton, width, height, 0)
    if (phaseOne.length) {
      changed = true
      for (const key of phaseOne) {
        skeleton[key] = 0
      }
    }

    const phaseTwo = collectThinPixels(skeleton, width, height, 1)
    if (phaseTwo.length) {
      changed = true
      for (const key of phaseTwo) {
        skeleton[key] = 0
      }
    }
  }

  pruneIsolatedPixels(skeleton, width, height)
  return skeleton
}

function collectThinPixels(mask: Uint8Array, width: number, height: number, phase: 0 | 1) {
  const toRemove: number[] = []

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const key = y * width + x
      if (!mask[key]) {
        continue
      }

      const p2 = mask[(y - 1) * width + x]
      const p3 = mask[(y - 1) * width + x + 1]
      const p4 = mask[y * width + x + 1]
      const p5 = mask[(y + 1) * width + x + 1]
      const p6 = mask[(y + 1) * width + x]
      const p7 = mask[(y + 1) * width + x - 1]
      const p8 = mask[y * width + x - 1]
      const p9 = mask[(y - 1) * width + x - 1]
      const ring = [p2, p3, p4, p5, p6, p7, p8, p9]

      const neighbors = ring.reduce((sum, value) => sum + value, 0)
      if (neighbors < 2 || neighbors > 6) {
        continue
      }

      let transitions = 0
      for (let index = 0; index < ring.length; index += 1) {
        if (ring[index] === 0 && ring[(index + 1) % ring.length] === 1) {
          transitions += 1
        }
      }
      if (transitions !== 1) {
        continue
      }

      if (phase === 0) {
        if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) {
          continue
        }
      } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) {
        continue
      }

      toRemove.push(key)
    }
  }

  return toRemove
}

function extractStrokeSegments(mask: Uint8Array, width: number, height: number) {
  const activeKeys: number[] = []
  for (let key = 0; key < mask.length; key += 1) {
    if (mask[key]) {
      activeKeys.push(key)
    }
  }

  const neighbors = new Map<number, number[]>()
  for (const key of activeKeys) {
    const x = key % width
    const y = Math.floor(key / width)
    const linked: number[] = []

    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nextX = x + dx
      const nextY = y + dy
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        continue
      }

      const nextKey = nextY * width + nextX
      if (mask[nextKey]) {
        linked.push(nextKey)
      }
    }

    neighbors.set(key, linked)
  }

  const nodes = new Set(activeKeys.filter((key) => (neighbors.get(key)?.length ?? 0) !== 2))
  const visitedEdges = new Set<string>()
  const segments: Vec2[][] = []

  for (const node of nodes) {
    for (const next of neighbors.get(node) ?? []) {
      const edge = edgeKey(node, next)
      if (visitedEdges.has(edge)) {
        continue
      }

      const segmentKeys = walkSegment(node, next, nodes, neighbors, visitedEdges)
      if (segmentKeys.length >= MIN_SEGMENT_POINTS) {
        segments.push(segmentKeys.map((key) => [key % width, Math.floor(key / width)] as Vec2))
      }
    }
  }

  for (const key of activeKeys) {
    for (const next of neighbors.get(key) ?? []) {
      const edge = edgeKey(key, next)
      if (visitedEdges.has(edge)) {
        continue
      }

      const loopKeys = walkLoop(key, next, neighbors, visitedEdges)
      if (loopKeys.length >= MIN_SEGMENT_POINTS) {
        segments.push(loopKeys.map((loopKey) => [loopKey % width, Math.floor(loopKey / width)] as Vec2))
      }
    }
  }

  segments.sort((left, right) => polylineLength(right) - polylineLength(left))
  return segments
}

function walkSegment(
  start: number,
  next: number,
  nodes: Set<number>,
  neighbors: Map<number, number[]>,
  visitedEdges: Set<string>,
) {
  const keys = [start, next]
  visitedEdges.add(edgeKey(start, next))

  let previous = start
  let current = next
  while (!nodes.has(current)) {
    const options = (neighbors.get(current) ?? []).filter((candidate) => candidate !== previous)
    if (!options.length) {
      break
    }

    const candidate = options[0]
    visitedEdges.add(edgeKey(current, candidate))
    keys.push(candidate)
    previous = current
    current = candidate
  }

  return keys
}

function walkLoop(start: number, next: number, neighbors: Map<number, number[]>, visitedEdges: Set<string>) {
  const keys = [start, next]
  visitedEdges.add(edgeKey(start, next))

  let previous = start
  let current = next
  while (true) {
    const options = (neighbors.get(current) ?? []).filter((candidate) => candidate !== previous)
    if (!options.length) {
      break
    }

    const candidate = options[0]
    const edge = edgeKey(current, candidate)
    if (visitedEdges.has(edge)) {
      if (candidate === start) {
        keys.push(candidate)
      }
      break
    }

    visitedEdges.add(edge)
    keys.push(candidate)
    previous = current
    current = candidate
  }

  return keys
}

function stitchSegments(segments: Vec2[][]) {
  const remaining = segments.slice()
  const first = remaining.shift()
  if (!first) {
    return []
  }

  const route = first.slice()
  while (remaining.length) {
    let bestIndex = 0
    let bestReverse = false
    let bestScore = Infinity
    const routeEnd = route[route.length - 1]

    for (let index = 0; index < remaining.length; index += 1) {
      const segment = remaining[index]
      const startScore = distance(routeEnd, segment[0]) + CONNECT_PENALTY / Math.max(1, polylineLength(segment))
      if (startScore < bestScore) {
        bestScore = startScore
        bestIndex = index
        bestReverse = false
      }

      const endScore = distance(routeEnd, segment[segment.length - 1]) + CONNECT_PENALTY / Math.max(1, polylineLength(segment))
      if (endScore < bestScore) {
        bestScore = endScore
        bestIndex = index
        bestReverse = true
      }
    }

    const [chosen] = remaining.splice(bestIndex, 1)
    appendPolyline(route, bestReverse ? chosen.slice().reverse() : chosen)
  }

  return route
}

function appendPolyline(target: Vec2[], segment: Vec2[]) {
  if (!segment.length) {
    return
  }

  const last = target[target.length - 1]
  const first = segment[0]
  if (!last) {
    target.push(...segment)
    return
  }

  const gap = distance(last, first)
  if (gap > 1.5) {
    const bridgeSteps = Math.max(1, Math.ceil(gap / 2.2))
    for (let step = 1; step <= bridgeSteps; step += 1) {
      const t = step / bridgeSteps
      target.push([
        last[0] + (first[0] - last[0]) * t,
        last[1] + (first[1] - last[1]) * t,
      ])
    }
  }

  for (let index = gap > 1.5 ? 1 : 0; index < segment.length; index += 1) {
    const point = segment[index]
    const previous = target[target.length - 1]
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      target.push(point)
    }
  }
}

function simplifyCollinear(points: Vec2[]) {
  if (points.length < 3) {
    return points.slice()
  }

  const simplified: Vec2[] = [points[0]]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1]
    const current = points[index]
    const next = points[index + 1]
    const dx1 = current[0] - previous[0]
    const dy1 = current[1] - previous[1]
    const dx2 = next[0] - current[0]
    const dy2 = next[1] - current[1]
    const cross = Math.abs(dx1 * dy2 - dy1 * dx2)
    if (cross > 0.001 || distance(previous, current) > 2.4) {
      simplified.push(current)
    }
  }
  simplified.push(points[points.length - 1])
  return simplified
}

function polylineLength(points: Vec2[]) {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index])
  }
  return total
}

function fitToViewport(points: Vec2[], viewportWidth: number, viewportHeight: number) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const scale = Math.min((viewportWidth * FIT_WIDTH_RATIO) / width, (viewportHeight * FIT_HEIGHT_RATIO) / height)
  const offsetX = viewportWidth * 0.5 - (minX + width / 2) * scale
  const offsetY = viewportHeight * 0.54 - (minY + height / 2) * scale

  return points.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY] as Vec2)
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function edgeKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
