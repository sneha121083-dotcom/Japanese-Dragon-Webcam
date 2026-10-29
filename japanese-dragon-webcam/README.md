# Ryū — Cinematic Webcam-Controlled Japanese Dragon

A browser-based 3D Japanese-inspired dragon experience built with Three.js and MediaPipe Hand Landmarker. Version 2 uses a larger hero frame, a thicker serpentine body, broad bat-like wings with ribs, a larger horned head, whiskers, armor-like belly plates, and a fire particle system. It is still procedural 3D geometry rather than a scanned or professionally sculpted model.

## Requirements
- Windows, macOS, or Linux
- Node.js 20.19+ or 22.12+ (recommended: current Node.js LTS)
- Chrome or Edge recommended
- Internet connection on first run (MediaPipe's WASM and hand model load from their public CDNs)
- Webcam permission

## Run on Windows (PowerShell or VS Code terminal)
1. Extract `japanese-dragon-webcam.zip`.
2. Open the extracted `japanese-dragon-webcam` folder in VS Code.
3. Open Terminal → New Terminal.
4. Run:

```bash
npm install
npm run dev
```

5. Open the exact local URL Vite prints (usually `http://127.0.0.1:5173`).
6. Click **ACTIVATE CAMERA** and allow camera access. Keep your hand inside the preview.

Do not open `index.html` by double-clicking it. Webcam access and module loading need the local development server.

## Gestures
- **Open palm:** steer the dragon by moving your hand horizontally/vertically.
- **Fist:** charge the fire meter.
- **V sign (index + middle fingers up, ring + pinky down):** trigger a short fire burst.
- **Index finger only:** steer.

The dragon performs a graceful idle flight when no hand is detected.

## If something goes wrong
- **Camera blocked:** click the camera/lock icon in the address bar and allow camera access, then reload.
- **Model won't load:** check the internet connection. The app downloads MediaPipe's WASM runtime and hand model from Google-hosted CDNs.
- **Black screen:** make sure you ran `npm run dev`, then open the Vite localhost URL in Chrome/Edge. Check DevTools Console for errors.
- **GPU delegate error:** if the console reports a GPU delegate initialization error, change `delegate:'GPU'` to `delegate:'CPU'` in `src/main.js` and reload.
- **Port already in use:** Vite will print a different port; use the one it prints.
- **No hand detected:** improve lighting, keep your full hand visible, and face your palm toward the camera.

## Production build
```bash
npm run build
npm run preview
```

## Privacy
The webcam stream is processed in the browser. This app does not contain code that uploads camera frames to an application server. MediaPipe's runtime and model files are downloaded from their public CDNs.
