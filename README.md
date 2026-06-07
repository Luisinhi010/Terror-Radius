# Terrorradius

A dynamic layered music player for Dead by Daylight and Forsaken terror radius themes.
Paste four audio URLs (L1 → L2 → L3 → Chase) and drag the proximity slider to hear how
the mix changes as the killer gets closer.

> **Live demo →** *(add Vercel/GitHub Pages URL here after deploying)*

---

## Features

- **Two mix modes** — Dead by Daylight (smooth crossfade between layers) and Forsaken (hard zone cuts with configurable lerp speed)
- **Crossfade curves** — Linear or Equal-Power
- **Per-layer waveform visualisers** and a combined frequency spectrum
- **Volume curve graph** — SVG chart of all 4 layer volumes across the 0–100% range
- **Presets sidebar** — 3 built-in presets (CURTAINS_CALL, Nil.Incident, The Singularity) + save/load favourites
- **Export / Import** — full JSON config including saved presets
- **Proximity vignette**, smooth approach animation, keyboard shortcuts
- **Tauri desktop app** — compact floating bar mode, always-on-top, Android APK build
- Web Audio API with gapless looping and sample-accurate DBD chase sync

---

## Running locally

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/terrorradius.git
cd terrorradius
npm install

# Web only (no Tauri features)
npm run dev

# Full desktop app (requires Rust + Tauri CLI)
npm run tauri:dev
```

The web version runs at `http://localhost:5173`. Tauri features (compact mode, always-on-top)
are hidden automatically when running in a browser.

---

## Building

```bash
# Web build — produces dist/ folder
npm run build

# Windows desktop app
npm run tauri:build

# Android APK
npm run tauri:android:build
```

---

## Deploying to the web

The `dist/` folder is a plain static site. It works on any static host.

### Vercel (recommended — one click)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo
3. Framework preset: **Vite**
4. Build command: `npm run build`
5. Output directory: `dist`
6. Click **Deploy**

### GitHub Pages

1. In `vite.config.ts`, add `base: '/terrorradius/'` (replace with your repo name)
2. Install the deploy helper: `npm install --save-dev gh-pages`
3. Add to `package.json` scripts: `"deploy": "gh-pages -d dist"`
4. Run: `npm run build && npm run deploy`

---

## Tech stack

- [React 18](https://react.dev/) + TypeScript
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Tauri v2](https://tauri.app/) — desktop & Android packaging
- Web Audio API — all audio logic (no `<audio>` elements)

---

## License

MIT — see [LICENSE](LICENSE)
