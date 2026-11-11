# Tile Studio bridge (Claude Code ⇄ Tile Map Studio)

Lets **Claude Code** (your Claude subscription, no API key) drive the Tile Map Studio page, and lets the page hand work to Claude Code.

```
Tile Map Studio (browser)  ⇄  http://127.0.0.1:8787  ⇄  bridge/server.mjs  ⇄  Claude Code (MCP, stdio)
```

Everything stays on your computer. The server only listens on `127.0.0.1` and only accepts requests from `localhost` pages (plus origins you add).

## Setup (once)

1. Install **Node 20+** and **Claude Code** on the computer you will use.
2. Get this repo: `git clone https://github.com/Everest1508/tiled && cd tiled/bridge && npm install`
3. Register the server with Claude Code (use your real absolute path):
   ```
   claude mcp add tile-studio -- node /absolute/path/to/tiled/bridge/server.mjs
   ```

## Use

1. Start the page on the same computer: `cd web && npm install && npm run dev` (or open your deployed page).
2. Start Claude Code inside the repo (`cd tiled && claude`), so the `/tile-studio` command is available. To use it from any folder, copy `.claude/commands/tile-studio.md` to `~/.claude/commands/`. The MCP prompt `/mcp__tile-studio__work` does the same.
3. In the page: **Connect Claude → Claude Code**. It should say *Connected*.
4. Run `/tile-studio` in Claude Code and leave it running. Now:
   - Press any Claude button on the page (Name tiles, Generate map, Area options, Apply change). The job goes to Claude Code, which does it and the result appears on the page.
   - Or just talk to Claude Code: "name the tiles on my sheet", "make a 48x32 village", "give me 4 options for the selected area". It sees your tilesheets, the map and the selection, and changes the page live.

## Deployed page (Vercel etc.)

Browsers let an https page talk to `127.0.0.1` (Chrome may ask for permission to access local devices). Allow your site explicitly:
```
claude mcp add tile-studio -e TILE_STUDIO_ORIGINS=https://your-site.vercel.app -- node /absolute/path/to/tiled/bridge/server.mjs
```
Environment: `TILE_STUDIO_PORT` (default 8787), `TILE_STUDIO_ORIGINS` (comma separated).

## Tools Claude Code gets

`studio_status`, `get_catalog`, `get_tileset_image`, `get_map`, `set_tile_names`, `set_map`, `set_area_options`, `next_job`, `finish_job`.

## Notes

- Claude Code runs on a computer. A phone cannot host this bridge, and Claude Code on the web runs in the cloud and cannot reach `127.0.0.1`. On a phone, use the API key mode, or open the page on the computer.
- Jobs are handled when Claude Code is looping on `next_job`. If nothing happens after pressing a button, check that `/tile-studio` is still running.
- Tests: `npm test`.
