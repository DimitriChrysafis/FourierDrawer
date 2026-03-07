/// <reference lib="webworker" />

import type {
  Harmonic,
  ProcessStrokeRequest,
  ProcessStrokeResponse,
  ProcessStrokeSuccess,
  Vec2,
} from '../app/types'

const workerContext = self as DedicatedWorkerGlobalScope

workerContext.onmessage = (event: MessageEvent<ProcessStrokeRequest>) => {
  try {
    const response = processStroke(event.data)
    workerContext.postMessage(response)
  } catch (error) {
    const response: ProcessStrokeResponse = {
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown worker error',
    }
    workerContext.postMessage(response)
  }
}

function processStroke(request: ProcessStrokeRequest): ProcessStrokeSuccess {
  const sanitized = sanitizePoints(request.points)
  if (sanitized.length < 8) {
    throw new Error('Draw a longer stroke.')
  }

  const smoothed = smoothPath(sanitized, request.smoothingRadius)
  const normalized = normalizeStroke(smoothed)
  const resampled = resamplePath(normalized, request.sampleCount)
  const centered = centerPoints(resampled)
  const referencePoints = sanitized.map(([x, y]) => [x - centered.origin[0], y - centered.origin[1]] as Vec2)
  const harmonics = computeHarmonics(centered.points, request.harmonicCount)

  return {
    id: request.id,
    ok: true,
    rawPointCount: request.points.length,
    processedPointCount: centered.points.length,
    orderedPoints: centered.points,
    referencePoints,
    harmonics,
    origin: centered.origin,
  }
}

function sanitizePoints(points: Vec2[]) {
  const cleaned: Vec2[] = []
  for (const point of points) {
    const last = cleaned[cleaned.length - 1]
    if (!last || distance(last, point) >= 0.5) {
      cleaned.push(point)
    }
  }
  return cleaned
}

function smoothPath(points: Vec2[], radius: number) {
  if (points.length < radius * 2 + 1 || radius <= 0) {
    return points.slice()
  }

  const smoothed: Vec2[] = []
  for (let index = 0; index < points.length; index += 1) {
    let totalX = 0
    let totalY = 0
    let totalWeight = 0

    for (let offset = -radius; offset <= radius; offset += 1) {
      const sampleIndex = clamp(index + offset, 0, points.length - 1)
      const weight = radius + 1 - Math.abs(offset)
      totalX += points[sampleIndex][0] * weight
      totalY += points[sampleIndex][1] * weight
      totalWeight += weight
    }

    smoothed.push([totalX / totalWeight, totalY / totalWeight])
  }

  return smoothed
}

function normalizeStroke(points: Vec2[]) {
  let normalized = points.slice()

  const closureThreshold = Math.max(8, boundingDiagonal(normalized) * 0.08)
  if (distance(normalized[0], normalized[normalized.length - 1]) <= closureThreshold) {
    normalized[normalized.length - 1] = normalized[0]
  }

  if (isClosed(normalized)) {
    if (signedArea(normalized) < 0) {
      normalized = normalized.slice().reverse()
    }

    let anchorIndex = 0
    for (let index = 1; index < normalized.length; index += 1) {
      const [x, y] = normalized[index]
      const [bestX, bestY] = normalized[anchorIndex]
      if (x < bestX || (x === bestX && y > bestY)) {
        anchorIndex = index
      }
    }

    normalized = normalized.slice(anchorIndex).concat(normalized.slice(0, anchorIndex))
  }

  return normalized
}

function resamplePath(points: Vec2[], sampleCount: number) {
  if (points.length < 2) {
    return points.slice()
  }

  const closed = isClosed(points)
  const segmentLimit = closed ? points.length : points.length - 1
  const lengths: number[] = []
  let totalLength = 0

  for (let index = 0; index < segmentLimit; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % points.length]
    const length = distance(start, end)
    lengths.push(length)
    totalLength += length
  }

  if (totalLength === 0) {
    throw new Error('The stroke collapsed to zero length.')
  }

  const divisor = closed ? sampleCount : Math.max(1, sampleCount - 1)
  const step = totalLength / divisor
  const result: Vec2[] = []
  let segmentIndex = 0
  let traversed = 0
  let target = 0

  while (result.length < sampleCount && segmentIndex < lengths.length) {
    const segmentLength = lengths[segmentIndex]
    if (traversed + segmentLength >= target) {
      const start = points[segmentIndex]
      const end = points[(segmentIndex + 1) % points.length]
      const local = target - traversed
      const ratio = segmentLength === 0 ? 0 : local / segmentLength
      result.push([
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ])
      target += step
      continue
    }

    traversed += segmentLength
    segmentIndex += 1
  }

  while (result.length < sampleCount) {
    result.push(points[points.length - 1])
  }

  return result
}

function centerPoints(points: Vec2[]) {
  let sumX = 0
  let sumY = 0
  for (const [x, y] of points) {
    sumX += x
    sumY += y
  }

  const origin: Vec2 = [sumX / points.length, sumY / points.length]
  return {
    origin,
    points: points.map(([x, y]) => [x - origin[0], y - origin[1]] as Vec2),
  }
}

function computeHarmonics(points: Vec2[], harmonicCount: number) {
  const count = points.length
  const coefficients: Harmonic[] = []

  for (let frequency = -Math.floor(count / 2); frequency < Math.ceil(count / 2); frequency += 1) {
    let re = 0
    let im = 0

    for (let index = 0; index < count; index += 1) {
      const [x, y] = points[index]
      const angle = (-2 * Math.PI * frequency * index) / count
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      re += x * cos - y * sin
      im += x * sin + y * cos
    }

    re /= count
    im /= count

    coefficients.push({
      frequency,
      re,
      im,
      amplitude: Math.hypot(re, im),
      phase: Math.atan2(im, re),
    })
  }

  const selected = coefficients
    .slice()
    .sort((left, right) => {
      if (left.frequency === 0) return -1
      if (right.frequency === 0) return 1
      if (right.amplitude !== left.amplitude) {
        return right.amplitude - left.amplitude
      }
      return Math.abs(left.frequency) - Math.abs(right.frequency)
    })
    .slice(0, Math.min(harmonicCount, coefficients.length))

  selected.sort((left, right) => {
    if (left.frequency === 0) return -1
    if (right.frequency === 0) return 1
    return right.amplitude - left.amplitude
  })

  return selected
}

function isClosed(points: Vec2[]) {
  return distance(points[0], points[points.length - 1]) < 1e-6
}

function signedArea(points: Vec2[]) {
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    total += current[0] * next[1] - next[0] * current[1]
  }
  return total / 2
}

function boundingDiagonal(points: Vec2[]) {
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

  return Math.hypot(maxX - minX, maxY - minY)
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
