# Terror Radius

A dynamic layered music player for Dead by Daylight and Forsaken terror radius themes.
Paste four audio URLs (L1 → L2 → L3 → Chase) and drag the proximity slider to hear how
the mix changes as the killer gets closer.
You can also choose local audio with the folder button on each layer card.

> **[Live demo](https://terror-radius.vercel.app/)**

---

## Features

- **Two mix modes** — Dead by Daylight (smooth crossfade between layers) and Forsaken (hard zone cuts with configurable lerp speed)
- **Crossfade curves** — Linear or Equal-Power
- **Per-layer waveform visualisers** and a combined frequency spectrum
- **Volume curve graph** — SVG chart of all 4 layer volumes across the 0–100% range
- **Presets sidebar** — 2 built-in presets (CURTAINS_CALL, No Virus) + save/load favourites
- **Export / Import** — full JSON config including saved presets
- **Proximity vignette**, smooth approach animation, keyboard shortcuts
- **Tauri desktop app** — compact floating bar mode, always-on-top, Android APK build
- Web Audio API with gapless looping and sample-accurate DBD chase sync
- **System media controls** — headset/media keys stop and restart stems; the native seek bar controls proximity

### System media controls

Start playback once from the page. In supported browsers, the system player shows
the preset/favorite name (or `Custom Setup`) as the title and active layers plus
proximity in the artist field. Pause/Stop from the system immediately stops all
stems; Play restarts the mix together from zero, keeping the chosen proximity.
The page's Stop button still honors the smooth Play/Stop preference.

The native seek bar maps 0–100 to proximity, including Safe and Chase. Native seeks
apply immediately even with Smooth approach enabled, so they work while animation
frames are suspended in the background. A locally generated, unmuted silent WAV
loops at normal speed to activate the media session. The reported position uses
duration 100 and playbackRate 0.000001; this does not change the stems' speed.
Metadata/position updates follow state changes, with no periodic correction timer.

This carries over the experiment tested on the user's PC and Android in Test-Radius.
Other browsers/WebViews may omit seeking, display seconds instead of percentages,
or ignore the tiny position rate. Unsupported Media Session actions are skipped;
browsers without Media Session retain the Web Audio player. Persistence in recent
media after closing the page is controlled by the OS/browser, not guaranteed here.

To check the integration on a device, test built-in and local stems, headset
Pause → Play, native seeks at 0/50/100%, screen lock (also with Smooth approach),
and switching to another audio app. Desktop/Tauri WebViews require their own test.
See the [Media Session guide](https://web.dev/articles/media-session) and
[position API](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setPositionState).

### Built-in songs

Edit [`src/data/builtin-presets.json`](src/data/builtin-presets.json) to add,
remove or update built-in songs. Each entry has a unique, stable `id`, a `name`,
a `defaultMixMode` (`forsaken` or `dbd`), and four audio URLs under `urls`:
`l1`, `l2`, `l3` and `chase`. Keep existing IDs when updating a song.
Rebuild/redeploy the app after changing the JSON; favorites and user-provided
audio remain separate from this catalog.

### Music credits

Built-in Forsaken tracks are credited to their respective composers:
[NO VIRUS / nil.incident — Lymphh](https://youtu.be/aGfwg6_UElM) and
[CURTAINS_CALL — Vladosikos17](https://youtu.be/NOwF988s6_E).
This is an unofficial, non-commercial fan project, not affiliated with Forsaken
or Roblox. The Forsaken Development Team's public announcement permits credited
use in videos and fan-made remixes; it is not presented here as confirmation of
permission specifically for this app. Third-party music is not covered by this
repository's MIT license. Users should only supply audio they have permission to use.

### Local audio files

- The layer cards preserve the local-file UI from the uploaded development version:
  folder picker, filename badge, remove button, waveform and Solo/Mute controls.
- Browsers use a file input and an in-memory object URL. Tauri desktop uses its
  native dialog; the asset protocol starts with an empty scope and only the
  user-selected paths are allowed by the dialog plugin. Mobile uses a file input.
- Local files are **session-only** on both paths. The app does not upload them or
  copy the audio into JSON. Reselect them after reopening the app.
- Favorites can reuse local audio within the current session, including after
  entering/exiting compact mode. Stored/exported favorites keep their names and
  remote URLs, but local-source fields become empty. Exports flag this with
  `localFilesOmitted`; stale local URLs from older saved configs are also cleared.
- Replaced blobs are revoked only after no active layer or session favorite uses
  them. File-picker cancellation/unmount also releases its temporary UI.
- Supported formats depend on the browser/WebView decoder. The picker filter is
  not a guarantee that every listed codec will decode on every platform.

### Loading and synchronization

URL typing is debounced for 350 ms (clearing a field applies immediately).
Only changed URLs are downloaded again. Replacing audio temporarily silences the
previous mix, waits for the latest pending loads across **all** layers, then starts
all available buffers on one shared clock. Unchanged buffers are reused but also
restart, so the mix cannot contain stems with mismatched playback offsets.
Failed or cleared layers stay silent. Stop always cancels playback intent, even
when a download, decode or `AudioContext.resume()` is still pending.

---

## Running locally

```bash
# Clone and install
git clone https://github.com/Luisinhi010/Terror-Radius.git
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

## Tests

```bash
npm ci
npm test
npm run build
```

The regression suite uses mocked fetch/decode/Web Audio timing and DOM tests.
It covers overlapping selections, out-of-order loading, StrictMode replay,
Play/Stop races, cancellation, source ownership and portable config handling.
Native file-dialog and platform codec behavior still require testing in Tauri on
the target operating system; a web build alone does not validate native behavior.

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

- [React 19](https://react.dev/) + TypeScript
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Tauri v2](https://tauri.app/) — desktop & Android packaging
- Web Audio API — stem mixing, with a silent HTML audio carrier for Media Session

---

## License

MIT — see [LICENSE](LICENSE)
