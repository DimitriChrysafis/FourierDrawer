const DEMO_IMAGE_URL = "../demo/mona-outline.png";
const TRACE_MAX_SIZE = 960;
const MIN_THRESHOLD = 170;
const MAX_THRESHOLD = 244;
const WIDTH_FIT = 0.66;
const HEIGHT_FIT = 0.84;
const MIN_SEGMENT_LENGTH = 6;
const CHAIN_PENALTY = 14;
const NEIGHBOR_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export async function buildDemoPoints(viewportWidth, viewportHeight) {
  const bitmap = await loadDemoBitmap();

  try {
    const { width, height, mask } = rasterizeMask(bitmap);
    const skeleton = thinMask(mask, width, height);
    const segments = extractSegments(skeleton, width, height);

    if (!segments.length) {
      throw new Error("The demo outline could not be turned into a stroke.");
    }

    const stitched = stitchSegments(segments);

    if (stitched.length < 24) {
      throw new Error("The demo outline did not produce enough ordered points.");
    }

    return fitPointsToViewport(cleanCollinearPoints(stitched), viewportWidth, viewportHeight);
  } finally {
    bitmap.close();
  }
}

async function loadDemoBitmap() {
  const response = await fetch(DEMO_IMAGE_URL);

  if (!response.ok) {
    throw new Error(`Failed to load demo image: ${response.status}`);
  }

  return createImageBitmap(await response.blob());
}

function rasterizeMask(bitmap) {
  const scale = Math.min(1, TRACE_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(48, Math.round(bitmap.width * scale));
  const height = Math.max(48, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Could not create a 2D context for demo tracing.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.drawImage(bitmap, 0, 0, width, height);

  const rgba = context.getImageData(0, 0, width, height).data;
  const grayscale = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);

  for (let rgbaIndex = 0, pixelIndex = 0; rgbaIndex < rgba.length; rgbaIndex += 4, pixelIndex += 1) {
    const alpha = rgba[rgbaIndex + 3] / 255;
    const intensity = Math.round(
      (0.2126 * rgba[rgbaIndex] +
        0.7152 * rgba[rgbaIndex + 1] +
        0.0722 * rgba[rgbaIndex + 2]) *
        alpha +
        255 * (1 - alpha),
    );

    grayscale[pixelIndex] = intensity;
    histogram[intensity] += 1;
  }

  const cutoff = percentile(histogram, 0.985);
  const threshold = clamp(cutoff - 10, MIN_THRESHOLD, MAX_THRESHOLD);
  const mask = new Uint8Array(width * height);

  for (let index = 0; index < grayscale.length; index += 1) {
    if (grayscale[index] <= threshold) {
      mask[index] = 1;
    }
  }

  pruneIsolatedPixels(mask, width, height);
  bridgeDiagonalGaps(mask, width, height);

  return { width, height, mask };
}

function percentile(histogram, fraction) {
  let total = 0;

  for (const count of histogram) {
    total += count;
  }

  const target = total * fraction;
  let running = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    running += histogram[value];
    if (running >= target) {
      return value;
    }
  }

  return histogram.length - 1;
}

function pruneIsolatedPixels(mask, width, height) {
  const copy = mask.slice();

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;

      if (!copy[index]) {
        continue;
      }

      let neighborCount = 0;

      for (const [offsetX, offsetY] of NEIGHBOR_OFFSETS) {
        neighborCount += copy[(y + offsetY) * width + (x + offsetX)];
      }

      if (neighborCount <= 1) {
        mask[index] = 0;
      }
    }
  }
}

function bridgeDiagonalGaps(mask, width, height) {
  const additions = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;

      if (mask[index]) {
        continue;
      }

      const left = mask[index - 1];
      const right = mask[index + 1];
      const up = mask[index - width];
      const down = mask[index + width];
      const upLeft = mask[index - width - 1];
      const downRight = mask[index + width + 1];
      const upRight = mask[index - width + 1];
      const downLeft = mask[index + width - 1];

      if ((left && right) || (up && down) || (upLeft && downRight) || (upRight && downLeft)) {
        additions.push(index);
      }
    }
  }

  for (const index of additions) {
    mask[index] = 1;
  }
}

function thinMask(mask, width, height) {
  const result = mask.slice();
  let changed = true;

  while (changed) {
    changed = false;

    const firstPass = zhangSuenPass(result, width, height, 0);
    if (firstPass.length) {
      changed = true;
      for (const index of firstPass) {
        result[index] = 0;
      }
    }

    const secondPass = zhangSuenPass(result, width, height, 1);
    if (secondPass.length) {
      changed = true;
      for (const index of secondPass) {
        result[index] = 0;
      }
    }
  }

  pruneIsolatedPixels(result, width, height);
  return result;
}

function zhangSuenPass(mask, width, height, pass) {
  const removals = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;

      if (!mask[index]) {
        continue;
      }

      const n = mask[(y - 1) * width + x];
      const ne = mask[(y - 1) * width + x + 1];
      const e = mask[y * width + x + 1];
      const se = mask[(y + 1) * width + x + 1];
      const s = mask[(y + 1) * width + x];
      const sw = mask[(y + 1) * width + x - 1];
      const w = mask[y * width + x - 1];
      const nw = mask[(y - 1) * width + x - 1];
      const neighbors = [n, ne, e, se, s, sw, w, nw];
      const occupied = neighbors.reduce((sum, value) => sum + value, 0);

      if (occupied < 2 || occupied > 6) {
        continue;
      }

      let transitions = 0;
      for (let i = 0; i < neighbors.length; i += 1) {
        if (neighbors[i] === 0 && neighbors[(i + 1) % neighbors.length] === 1) {
          transitions += 1;
        }
      }

      if (transitions !== 1) {
        continue;
      }

      if (pass === 0) {
        if (n * e * s !== 0 || e * s * w !== 0) {
          continue;
        }
      } else if (n * e * w !== 0 || n * s * w !== 0) {
        continue;
      }

      removals.push(index);
    }
  }

  return removals;
}

function extractSegments(mask, width, height) {
  const activePixels = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      activePixels.push(index);
    }
  }

  const adjacency = new Map();

  for (const index of activePixels) {
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [];

    for (const [offsetX, offsetY] of NEIGHBOR_OFFSETS) {
      const nextX = x + offsetX;
      const nextY = y + offsetY;

      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        continue;
      }

      const nextIndex = nextY * width + nextX;
      if (mask[nextIndex]) {
        neighbors.push(nextIndex);
      }
    }

    adjacency.set(index, neighbors);
  }

  const junctions = new Set(activePixels.filter((index) => (adjacency.get(index)?.length ?? 0) !== 2));
  const visitedEdges = new Set();
  const chains = [];

  for (const start of junctions) {
    for (const neighbor of adjacency.get(start) ?? []) {
      const edgeId = edgeKey(start, neighbor);

      if (visitedEdges.has(edgeId)) {
        continue;
      }

      const chain = walkOpenChain(start, neighbor, junctions, adjacency, visitedEdges);
      if (chain.length >= MIN_SEGMENT_LENGTH) {
        chains.push(chain.map(toPoint(width)));
      }
    }
  }

  for (const start of activePixels) {
    for (const neighbor of adjacency.get(start) ?? []) {
      const edgeId = edgeKey(start, neighbor);

      if (visitedEdges.has(edgeId)) {
        continue;
      }

      const loop = walkLoop(start, neighbor, adjacency, visitedEdges);
      if (loop.length >= MIN_SEGMENT_LENGTH) {
        chains.push(loop.map(toPoint(width)));
      }
    }
  }

  return chains.sort((a, b) => polylineLength(b) - polylineLength(a));
}

function walkOpenChain(start, next, junctions, adjacency, visitedEdges) {
  const chain = [start, next];

  visitedEdges.add(edgeKey(start, next));

  let previous = start;
  let current = next;

  while (!junctions.has(current)) {
    const candidates = (adjacency.get(current) ?? []).filter((value) => value !== previous);
    if (!candidates.length) {
      break;
    }

    const following = candidates[0];
    visitedEdges.add(edgeKey(current, following));
    chain.push(following);
    previous = current;
    current = following;
  }

  return chain;
}

function walkLoop(start, next, adjacency, visitedEdges) {
  const chain = [start, next];

  visitedEdges.add(edgeKey(start, next));

  let previous = start;
  let current = next;

  for (;;) {
    const candidates = (adjacency.get(current) ?? []).filter((value) => value !== previous);
    if (!candidates.length) {
      break;
    }

    const following = candidates[0];
    const edgeId = edgeKey(current, following);

    if (visitedEdges.has(edgeId)) {
      if (following === start) {
        chain.push(following);
      }
      break;
    }

    visitedEdges.add(edgeId);
    chain.push(following);
    previous = current;
    current = following;
  }

  return chain;
}

function stitchSegments(segments) {
  const remaining = segments.slice();
  const first = remaining.shift();

  if (!first) {
    return [];
  }

  const stitched = first.slice();

  while (remaining.length) {
    let bestIndex = 0;
    let reverse = false;
    let bestScore = Number.POSITIVE_INFINITY;
    const tail = stitched[stitched.length - 1];

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];

      const startScore = pointDistance(tail, candidate[0]) + CHAIN_PENALTY / Math.max(1, polylineLength(candidate));
      if (startScore < bestScore) {
        bestScore = startScore;
        bestIndex = i;
        reverse = false;
      }

      const endScore =
        pointDistance(tail, candidate[candidate.length - 1]) +
        CHAIN_PENALTY / Math.max(1, polylineLength(candidate));
      if (endScore < bestScore) {
        bestScore = endScore;
        bestIndex = i;
        reverse = true;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    appendInterpolated(stitched, reverse ? next.slice().reverse() : next);
  }

  return stitched;
}

function appendInterpolated(target, incoming) {
  if (!incoming.length) {
    return;
  }

  const tail = target[target.length - 1];
  const head = incoming[0];

  if (!tail) {
    target.push(...incoming);
    return;
  }

  const gap = pointDistance(tail, head);

  if (gap > 1.5) {
    const steps = Math.max(1, Math.ceil(gap / 2.2));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      target.push([
        tail[0] + (head[0] - tail[0]) * t,
        tail[1] + (head[1] - tail[1]) * t,
      ]);
    }
  }

  for (let index = gap > 1.5 ? 1 : 0; index < incoming.length; index += 1) {
    const point = incoming[index];
    const last = target[target.length - 1];

    if (!last || last[0] !== point[0] || last[1] !== point[1]) {
      target.push(point);
    }
  }
}

function cleanCollinearPoints(points) {
  if (points.length < 3) {
    return points.slice();
  }

  const cleaned = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = cleaned[cleaned.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const ax = current[0] - previous[0];
    const ay = current[1] - previous[1];
    const bx = next[0] - current[0];
    const by = next[1] - current[1];

    if (Math.abs(ax * by - ay * bx) > 0.001 || pointDistance(previous, current) > 2.4) {
      cleaned.push(current);
    }
  }

  cleaned.push(points[points.length - 1]);
  return cleaned;
}

function fitPointsToViewport(points, width, height) {
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

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width * WIDTH_FIT) / spanX, (height * HEIGHT_FIT) / spanY);
  const offsetX = width * 0.5 - (minX + spanX / 2) * scale;
  const offsetY = height * 0.54 - (minY + spanY / 2) * scale;

  return points.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY]);
}

function polylineLength(points) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += pointDistance(points[index - 1], points[index]);
  }

  return total;
}

function pointDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function toPoint(width) {
  return (index) => [index % width, Math.floor(index / width)];
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
