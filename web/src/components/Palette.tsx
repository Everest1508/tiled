import { useMemo, useState } from "react";
import { brushFromComp, brushFromTile, setState, useStore } from "../lib/store";
import { gid, gridOf, Tileset } from "../lib/types";
import Icon from "./Icon";
import TileThumb from "./TileThumb";

/** Tiles and objects to paint with, right next to the map. */
export default function Palette() {
  const tilesets = useStore((s) => s.tilesets);
  const brush = useStore((s) => s.brush);
  const [open, setOpen] = useState(true);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [query, setQuery] = useState("");
  const [onlyNamed, setOnlyNamed] = useState<boolean | null>(null);
  const ts: Tileset | undefined = tilesets[Math.min(sheetIdx, tilesets.length - 1)];

  const namedCount = ts ? Object.keys(ts.names).length : 0;
  const showNamedOnly = onlyNamed ?? namedCount > 0;
  const tiles = useMemo(() => {
    if (!ts) return [];
    const { count } = gridOf(ts);
    const q = query.trim().toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const name = ts.names[i];
      if (showNamedOnly && !name) continue;
      if (q && !(name ?? `tile ${i}`).toLowerCase().includes(q)) continue;
      out.push(i);
    }
    return out;
  }, [ts, query, showNamedOnly]);

  if (!ts) {
    return (
      <div className="palette">
        <p className="hint">Add a tilesheet to get tiles to paint with.</p>
        <button className="btn ghost sm" onClick={() => setState({ panel: "sheets" })}>Open tilesheets</button>
      </div>
    );
  }
  const selected = brush && brush.cols === 1 && brush.rows === 1 ? brush.gids[0] : 0;

  return (
    <div className="palette">
      <button className="pal-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="brush" size={16} />
        <strong>Tiles to paint</strong>
        <span className="dim pal-cur">{brush ? `Brush: ${brush.label}` : "Tap a tile"}</span>
        <span className="grow" />
        <span className="dim">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="pal-body">
          {tilesets.length > 1 && (
            <div className="chips">
              {tilesets.map((t, i) => <button key={t.id} className={`chip ${t.id === ts.id ? "on" : ""}`} onClick={() => setSheetIdx(i)}>{t.name}</button>)}
            </div>
          )}
          {ts.comps.length > 0 && (
            <div className="pal-objs" aria-label="Objects">
              {ts.comps.map((c) => (
                <button key={c.name} className={`pal-obj ${brush?.label === c.name && brush.cols === c.cols ? "on" : ""}`} title={`${c.name} (${c.cols}×${c.rows})`} onClick={() => setState({ brush: brushFromComp(ts, c), tool: "paint" })}>
                  <TileThumb ts={ts} local={c.ids.find((id) => id >= 0) ?? 0} size={28} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="pal-tools">
            <input className="search" placeholder="Search tiles" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tiles" />
            <label className="check sm"><input type="checkbox" checked={showNamedOnly} onChange={(e) => setOnlyNamed(e.target.checked)} /><span>Named only</span></label>
          </div>
          <div className="pal-grid" role="listbox" aria-label="Tiles">
            {tiles.map((i) => {
              const on = selected === gid(ts.slot, i);
              return (
                <button key={i} role="option" aria-selected={on} className={`pal-tile ${on ? "on" : ""}`} title={ts.names[i] ?? `tile ${i}`} onClick={() => setState({ brush: brushFromTile(ts, i), tool: "paint" })}>
                  <TileThumb ts={ts} local={i} size={36} />
                  {ts.names[i] && <span>{ts.names[i]}</span>}
                </button>
              );
            })}
            {tiles.length === 0 && <p className="hint">{namedCount === 0 ? "No tiles are named yet. Untick “Named only” to see every tile." : "No tiles match."}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
