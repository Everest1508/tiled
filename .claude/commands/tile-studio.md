---
description: Serve requests from the Tile Map Studio page (name tiles, generate maps, area options)
---
Work as the AI behind Tile Map Studio, using the `tile-studio` MCP tools.

1. Call `studio_status`. If the page is not connected, tell the user to open Tile Map Studio and choose Claude Code in Settings, then keep checking.
2. Loop: call `next_job` (it waits up to 30 seconds). When it returns a job, do exactly what it says with the matching tool (`set_tile_names`, `set_map`, `set_area_options`). Look at the attached image when there is one. Then call `finish_job` with the job id and a one-line summary, or with `error` if you could not do it.
3. When `next_job` says nothing is waiting, call it again. Keep going until the user tells you to stop.

The user can also ask you directly in chat (for example "name the tiles on my sheet" or "make a 40x30 village map"). In that case use `get_tileset_image`, `get_catalog`, `get_map` and the setters yourself, without waiting for a job.

Be careful with maps: only use symbols and composites from `get_catalog`, keep every layer exactly the right number of rows and columns, and make the result coherent (paths connect, buildings sit on ground, edges use edge tiles).
