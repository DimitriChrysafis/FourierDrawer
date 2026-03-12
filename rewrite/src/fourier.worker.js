self.onmessage = (event) => {
  try {
    const response = processStroke(event.data);
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown worker error",
    });
  }
};

function processStroke(payload) {
  const filtered = dedupePoints(payload.points);

  if (filtered.length < 8) {
    throw new Error("Draw a longer stroke.");
  }

  const smoothed = smoothPoints(filtered, payload.smoothingRadius);
  const ordered = canonicalizePath(smoothed);
  const resampled = resamplePath(ordered, payload.sampleCount);
  const centered = centerPoints(resampled);
  const referencePoints = filtered.map(([x, y]) => [x - centered.origin[0], y - centered.origin[1]]);
  const harmonics = buildHarmonics(centered.points, payload.harmonicCount);

  return {
    id: payload.id,
    ok: true,
    rawPointCount: payload.points.length,
    processedPointCount: centered.points.length,
    orderedPoints: centered.points,
    referencePoints,
    harmonics,
    origin: centered.origin,
  };
}

function dedupePoints(points) {
  const result = [];

  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || pointDistance(previous, point) >= 0.5) {
      result.push(point);
    }
  }

  return result;
}

function smoothPoints(points, radius) {
  if (points.length < radius * 2 + 1 || radius <= 0) {
    return points.slice();
  }

  const smoothed = [];

  for (let index = 0; index < points.length; index += 1) {
    let sumX = 0;
    let sumY = 0;
    let weightTotal = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const clampedIndex = clamp(index + offset, 0, points.length - 1);
      const weight = radius + 1 - Math.abs(offset);

      sumX += points[clampedIndex][0] * weight;
      sumY += points[clampedIndex][1] * weight;
      weightTotal += weight;
    }

    smoothed.push([sumX / weightTotal, sumY / weightTotal]);
  }

  return smoothed;
}

function canonicalizePath(points) {
  let path = points.slice();
  const closureThreshold = Math.max(8, boundingDiagonal(path) * 0.08);

  if (pointDistance(path[0], path[path.length - 1]) <= closureThreshold) {
    path[path.length - 1] = path[0];
  }

  if (isClosed(path)) {
    if (signedArea(path) < 0) {
      path = path.slice().reverse();
    }

    let anchorIndex = 0;

    for (let index = 1; index < path.length; index += 1) {
      const [x, y] = path[index];
      const [bestX, bestY] = path[anchorIndex];

      if (x < bestX || (x === bestX && y > bestY)) {
        anchorIndex = index;
      }
    }

    path = path.slice(anchorIndex).concat(path.slice(0, anchorIndex));
  }

  return path;
}

function resamplePath(points, sampleCount) {
  if (points.length < 2) {
    return points.slice();
  }

  const closed = isClosed(points);
  const segmentCount = closed ? points.length : points.length - 1;
  const segmentLengths = [];
  let totalLength = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    const length = pointDistance(points[index], points[(index + 1) % points.length]);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength === 0) {
    throw new Error("The stroke collapsed to zero length.");
  }

  const sampleSteps = closed ? sampleCount : Math.max(1, sampleCount - 1);
  const spacing = totalLength / sampleSteps;
  const samples = [];
  let segmentIndex = 0;
  let traveled = 0;
  let targetDistance = 0;

  while (samples.length < sampleCount && segmentIndex < segmentLengths.length) {
    const segmentLength = segmentLengths[segmentIndex];

    if (traveled + segmentLength >= targetDistance) {
      const start = points[segmentIndex];
      const end = points[(segmentIndex + 1) % points.length];
      const localDistance = targetDistance - traveled;
      const t = segmentLength === 0 ? 0 : localDistance / segmentLength;

      samples.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]);

      targetDistance += spacing;
      continue;
    }

    traveled += segmentLength;
    segmentIndex += 1;
  }

  while (samples.length < sampleCount) {
    samples.push(points[points.length - 1]);
  }

  return samples;
}

function centerPoints(points) {
  let sumX = 0;
  let sumY = 0;

  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
  }

  const origin = [sumX / points.length, sumY / points.length];

  return {
    origin,
    points: points.map(([x, y]) => [x - origin[0], y - origin[1]]),
  };
}

function buildHarmonics(points, harmonicCount) {
  const length = points.length;
  const harmonics = [];

  for (let frequency = -Math.floor(length / 2); frequency < Math.ceil(length / 2); frequency += 1) {
    let re = 0;
    let im = 0;

    for (let index = 0; index < length; index += 1) {
      const [x, y] = points[index];
      const angle = (-2 * Math.PI * frequency * index) / length;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      re += x * cos - y * sin;
      im += x * sin + y * cos;
    }

    re /= length;
    im /= length;

    harmonics.push({
      frequency,
      re,
      im,
      amplitude: Math.hypot(re, im),
      phase: Math.atan2(im, re),
    });
  }

  const strongest = harmonics
    .slice()
    .sort((a, b) => {
      if (a.frequency === 0) return -1;
      if (b.frequency === 0) return 1;
      if (b.amplitude !== a.amplitude) return b.amplitude - a.amplitude;
      return Math.abs(a.frequency) - Math.abs(b.frequency);
    })
    .slice(0, Math.min(harmonicCount, harmonics.length));

  return strongest.sort((a, b) => {
    if (a.frequency === 0) return -1;
    if (b.frequency === 0) return 1;
    return a.amplitude - b.amplitude;
  });
}

function isClosed(points) {
  return pointDistance(points[0], points[points.length - 1]) < 1e-6;
}

function signedArea(points) {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }

  return area / 2;
}

function boundingDiagonal(points) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return Math.hypot(maxX - minX, maxY - minY);
}

function pointDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
