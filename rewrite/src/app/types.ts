export type Vec2 = [number, number]

export interface ProcessingSettings {
  sampleCount: number
  harmonicCount: number
  smoothingRadius: number
}

export interface Harmonic {
  frequency: number
  re: number
  im: number
  amplitude: number
  phase: number
}

export interface ProcessStrokeRequest extends ProcessingSettings {
  id: number
  points: Vec2[]
}

export interface ProcessStrokeSuccess {
  id: number
  ok: true
  rawPointCount: number
  processedPointCount: number
  orderedPoints: Vec2[]
  referencePoints: Vec2[]
  harmonics: Harmonic[]
  origin: Vec2
}

export interface ProcessStrokeFailure {
  id: number
  ok: false
  error: string
}

export type ProcessStrokeResponse = ProcessStrokeSuccess | ProcessStrokeFailure

export interface RenderState {
  orderedPoints: Vec2[]
  referencePoints: Vec2[]
  harmonics: Harmonic[]
  origin: Vec2
}
