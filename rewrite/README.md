# Fourier Drawer Rewrite

A browser-based rewrite of the original project.

## What it does

- Uploads an image directly in the browser
- Extracts a drawable edge path in a worker thread
- Computes Fourier coefficients live
- Renders epicycles with GPU acceleration through Pixi
- Prefers `WebGPU`, then falls back to `WebGL`

## Run

```bash
cd rewrite
npm install
npm run dev
```

Then open the local Vite URL in your browser.

## Controls

- `Path points`: how many evenly resampled points the Fourier path uses
- `Harmonics`: how many coefficients drive the visible epicycles
- `Edge threshold`: higher means fewer detected edge pixels
- `Animation speed`: playback speed for one loop
- `Invert image`: useful when your drawing is dark-on-light vs light-on-dark

## Notes

- The heavy preprocessing runs in `src/workers/fourier.worker.ts`
- The live renderer is in `src/app/pixiScene.ts`
- The app is designed for single-image uploads and in-browser preview rather than offline frame export
