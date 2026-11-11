# Tile Map Studio

An AI tile map generator that runs entirely in the browser. Add one or more tilesheets, let Claude name the tiles, describe a map and generate it, then redo any area with several options.

## Features
- Multiple tilesheets in one project (tile size, margin, spacing per sheet)
- Claude names every tile and finds multi-tile objects (houses, trees). Names and objects can be edited by hand, and you can drag over tiles on a sheet to save your own objects
- Generate maps at chosen proportions (up to 96 x 96)
- Area options: select a region, get 2 to 6 alternatives, preview them on the map, apply one
- Refine the whole map with a text instruction
- Editor: paint, erase, layers, zoom and pan (mouse, wheel, pinch), undo and redo
- Export to Tiled (`.tmj`), tilesheet PNGs, a map PNG, or a project file you can reopen later
- Works on phones: bottom tabs, touch painting, pinch zoom

## Connecting Claude
Open **Connect Claude** in the header and paste an API key from the Anthropic Console. The key stays in your browser and is sent only to the API address in Settings (default `https://api.anthropic.com`). Tick "Remember on this device" to keep it between visits. If you prefer not to put a key in the browser, point the base URL at your own proxy that adds the key.

## Develop
```
cd web
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the prompt, map and API logic
npm run build    # output in web/dist
```

## Deploy
The build is static, so any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages). The included workflow `.github/workflows/web-pages.yml` builds the site on every push and deploys it to GitHub Pages from `master` once Pages is set to "GitHub Actions" in the repository settings.

## Claude Code mode (no API key)

Settings → Connect Claude → **Claude Code** lets Claude Code on your computer do the work through a local MCP bridge. See [`bridge/README.md`](../bridge/README.md).

## AI services

Settings → Connect an AI service: **Claude**, **OpenAI**, **Groq**, **Gemini**, **OpenRouter**, **Custom / local** (Ollama, LM Studio, any OpenAI-compatible server) or **Claude Code**. Each service remembers its own key and model. Model names change often, so type any id or press **Load models**. Naming tiles needs a model that accepts images; generating maps works with text-only models too.

## claude.ai artifact build

`npm run build:artifact` makes one self-contained `dist-artifact/index.html`. Inside a claude.ai artifact the page uses the built-in **claude.ai** service (no key) and the host's save prompt for exports (map files are saved as `.map.json`, which Tiled can open).
