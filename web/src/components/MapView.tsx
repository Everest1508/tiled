import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCatalog } from "../lib/catalog";
import { drawMap, drawTileGid } from "../lib/render";
import {
  addLayer, beginStroke, endStroke, moveLayer, newBlankMap, paintAt, removeLayer, renameLayer, setActiveLayer, setRegion, setState,
  Tool, toggleLayer, useStore, getState, brushFromTile,
} from "../lib/store";
import { clampRegion } from "../lib/mapops";
import { gidLocal, gidSlot, Rect } from "../lib/types";
import Icon from "./Icon";
import Palette from "./Palette";
import TileThumb from "./TileThumb";

const MIN_SCALE = 3;
const MAX_SCALE = 128;

function BrushBadge() {
  const brush = useStore((s) => s.brush);
  const tilesets = useStore((s) => s.tilesets);
  if (!brush) return <span className="brush-badge empty">No brush · pick tiles on a tilesheet</span>;
  const first = brush.gids.find((g) => g);
  const ts = first ? tilesets.find((t) => t.slot === gidSlot(first)) : undefined;
  return (
    <span className="brush-badge">
      {ts && first ? <TileThumb ts={ts} local={gidLocal(first)} size={22} /> : null}
      <span>{brush.label}</span>
    </span>
  );
}

function EmptyMap() {
  const tilesets = useStore((s) => s.tilesets);
  const named = useMemo(() => buildCatalog(tilesets).entries.length, [tilesets]);
  const [w, setW] = useState(32);
  const [h, setH] = useState(24);
  const step = (done: boolean, n: number, text: string) => (
    <li className={done ? "done" : ""}><span className="stepnum">{done ? <Icon name="check" size={14} /> : n}</span>{text}</li>
  );
  return (
    <div className="empty-map">
      <div className="empty-card">
        <span className="empty-art" aria-hidden="true"><Icon name="map" size={34} /></span>
        <h2>Let's build a map</h2>
        <ol className="steps">
          {step(tilesets.length > 0, 1, "Add one or more tilesheets")}
          {step(named > 0, 2, "Name the tiles (AI can do it for you)")}
          {step(false, 3, "Describe a map and generate it")}
        </ol>
        <div className="row wrap center">
          <button className="btn primary" onClick={() => setState({ panel: tilesets.length ? "ai" : "sheets", aiTab: "generate" })}>
            <Icon name="sparkles" size={16} /> {tilesets.length ? "Generate with AI" : "Add tilesheets"}
          </button>
        </div>
        <div className="blank">
          <span>Paint by hand:</span>
          <input type="number" min={4} max={96} value={w} onChange={(e) => setW(Math.max(4, Math.min(96, Number(e.target.value) || 4)))} aria-label="Width" />
          <span>×</span>
          <input type="number" min={4} max={96} value={h} onChange={(e) => setH(Math.max(4, Math.min(96, Number(e.target.value) || 4)))} aria-label="Height" />
          <button className="btn primary" onClick={() => {
            newBlankMap(w, h);
            const ts = tilesets[0];
            if (ts && !getState().brush) {
              const first = Object.keys(ts.names).map(Number).sort((a, b) => a - b)[0] ?? 0;
              setState({ brush: brushFromTile(ts, first), tool: "paint" });
            }
          }}>Create blank map</button>
        </div>
      </div>
    </div>
  );
}

function Layers() {
  const map = useStore((s) => s.map);
  const active = useStore((s) => s.activeLayerId);
  if (!map) return null;
  const layer = map.layers.find((l) => l.id === active);
  return (
    <div className="layers">
      <div className="layer-chips">
        {[...map.layers].reverse().map((l) => (
          <div key={l.id} className={`layer-chip ${l.id === active ? "on" : ""} ${l.visible ? "" : "off"}`}>
            <button className="eye" onClick={() => toggleLayer(l.id)} aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`}>
              <Icon name={l.visible ? "eye" : "eyeoff"} size={15} />
            </button>
            <button className="lname" onClick={() => setActiveLayer(l.id)}>{l.name}</button>
          </div>
        ))}
        <button className="layer-chip add" onClick={addLayer} aria-label="Add layer"><Icon name="plus" size={15} /> Layer</button>
      </div>
      {layer && (
        <div className="layer-ctl">
          <input defaultValue={layer.name} key={layer.id + layer.name} onBlur={(e) => renameLayer(layer.id, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label="Layer name" />
          <button className="icon-btn sm" onClick={() => moveLayer(layer.id, 1)} aria-label="Move layer up" title="Move up"><Icon name="up" size={16} /></button>
          <button className="icon-btn sm" onClick={() => moveLayer(layer.id, -1)} aria-label="Move layer down" title="Move down"><Icon name="down" size={16} /></button>
          <button className="icon-btn sm danger" disabled={map.layers.length <= 1} onClick={() => removeLayer(layer.id)} aria-label="Delete layer" title="Delete layer"><Icon name="trash" size={16} /></button>
        </div>
      )}
    </div>
  );
}

export default function MapView() {
  const map = useStore((s) => s.map);
  const version = useStore((s) => s.mapVersion);
  const tilesets = useStore((s) => s.tilesets);
  const tool = useStore((s) => s.tool);
  const brush = useStore((s) => s.brush);
  const showGrid = useStore((s) => s.showGrid);
  const region = useStore((s) => s.region);
  const variants = useStore((s) => s.variants);
  const selVariant = useStore((s) => s.selVariant);

  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const view = useRef({ scale: 20, ox: 0, oy: 0 });
  const hover = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  const [info, setInfo] = useState("");
  const [, bump] = useState(0);

  const draw = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = cv.current;
      const w = wrap.current;
      if (!c || !w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = w.clientWidth, ch = w.clientHeight;
      if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
        c.width = Math.round(cw * dpr);
        c.height = Math.round(ch * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const s = viewState.current;
      if (!s.map) return;
      const { scale, ox, oy } = view.current;
      const preview = s.selVariant >= 0 && s.region && s.variants[s.selVariant] ? { variant: s.variants[s.selVariant], region: s.region } : null;
      drawMap(ctx, s.map, { tilesets: s.tilesets, cell: scale, offsetX: ox, offsetY: oy, grid: s.showGrid, region: s.region, preview });
      const hv = hover.current;
      if (hv && hv.x >= 0 && hv.y >= 0 && hv.x < s.map.w && hv.y < s.map.h) {
        if (s.tool === "paint" && s.brush) {
          const byslot = new Map(s.tilesets.map((t) => [t.slot, t]));
          ctx.globalAlpha = 0.65;
          for (let r = 0; r < s.brush.rows; r++) for (let q = 0; q < s.brush.cols; q++) {
            const g = s.brush.gids[r * s.brush.cols + q];
            if (g && hv.x + q < s.map.w && hv.y + r < s.map.h) drawTileGid(ctx, byslot, g, ox + (hv.x + q) * scale, oy + (hv.y + r) * scale, scale, scale);
          }
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "rgba(255,255,255,.8)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(ox + hv.x * scale, oy + hv.y * scale, s.brush.cols * scale, s.brush.rows * scale);
        } else if (s.tool === "erase" || s.tool === "select") {
          ctx.strokeStyle = s.tool === "erase" ? "#ff6b7a" : "#a995ff";
          ctx.lineWidth = 2;
          ctx.strokeRect(ox + hv.x * scale, oy + hv.y * scale, scale, scale);
        }
      }
    });
  }, []);

  // Latest store values for the draw callback without re-creating it on every change.
  const viewState = useRef({ map, tilesets, showGrid, region, variants, selVariant, tool, brush });
  viewState.current = { map, tilesets, showGrid, region, variants, selVariant, tool, brush };

  const fit = useCallback(() => {
    const w = wrap.current;
    const m = viewState.current.map;
    if (!w || !m) return;
    const pad = 20;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((w.clientWidth - pad * 2) / m.w, (w.clientHeight - pad * 2) / m.h)));
    view.current = { scale, ox: (w.clientWidth - m.w * scale) / 2, oy: (w.clientHeight - m.h * scale) / 2 };
    bump((n) => n + 1);
    draw();
  }, [draw]);

  // Fit when a different-sized map appears, and whenever the container resizes.
  const dims = map ? `${map.w}x${map.h}` : "";
  useEffect(() => { fit(); }, [dims, fit]);
  useEffect(() => {
    const w = wrap.current;
    if (!w) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(w);
    return () => ro.disconnect();
  }, [draw, map === null]);

  useEffect(() => { draw(); }, [map, version, tilesets, showGrid, region, variants, selVariant, tool, brush, draw]);

  // Redraw when a tilesheet image finishes decoding after first render.
  useEffect(() => {
    const t = setTimeout(draw, 250);
    return () => clearTimeout(t);
  }, [tilesets, draw]);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    const v = view.current;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
    const k = scale / v.scale;
    view.current = { scale, ox: px - (px - v.ox) * k, oy: py - (py - v.oy) * k };
    bump((n) => n + 1);
    draw();
  }, [draw]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, map === null]);

  // ---- Pointer handling ---------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const mode = useRef<null | "paint" | "pan" | "select" | "pinch">(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const start = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const pinch = useRef({ d: 1, scale: 1, wx: 0, wy: 0 });

  const local = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const cellOf = (p: { x: number; y: number }) => ({
    x: Math.floor((p.x - view.current.ox) / view.current.scale),
    y: Math.floor((p.y - view.current.oy) / view.current.scale),
  });

  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    let { x, y } = a;
    const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y);
    const sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 4000; guard++) {
      paintAt(x, y);
      if (x === b.x && y === b.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  };

  const selectRect = (a: { x: number; y: number }, b: { x: number; y: number }): Rect | null => {
    const m = viewState.current.map;
    if (!m) return null;
    let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (x1 - x0 + 1 > 32) { if (b.x > a.x) x1 = x0 + 31; else x0 = x1 - 31; }
    if (y1 - y0 + 1 > 32) { if (b.y > a.y) y1 = y0 + 31; else y0 = y1 - 31; }
    return clampRegion({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, m);
  };

  const onDown = (e: React.PointerEvent) => {
    if (!map) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      if (mode.current === "paint") endStroke();
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v = view.current;
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: v.scale, wx: (mid.x - v.ox) / v.scale, wy: (mid.y - v.oy) / v.scale };
      mode.current = "pinch";
      return;
    }
    const t = viewState.current.tool;
    if (e.button === 1 || e.button === 2 || t === "pan" || e.altKey) {
      mode.current = "pan";
      start.current = { x: p.x, y: p.y, ox: view.current.ox, oy: view.current.oy };
    } else if (t === "paint" || t === "erase") {
      beginStroke();
      mode.current = "paint";
      const c = cellOf(p);
      paintAt(c.x, c.y);
      last.current = c;
    } else if (t === "select") {
      const c = cellOf(p);
      anchor.current = c;
      mode.current = "select";
      setRegion(selectRect(c, c));
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    const c = cellOf(p);
    if (e.pointerType === "mouse" || mode.current === "paint") hover.current = c;
    if (map && c.x >= 0 && c.y >= 0 && c.x < map.w && c.y < map.h) setInfo(`${c.x}, ${c.y}`); else setInfo("");
    if (!pointers.current.has(e.pointerId)) { draw(); return; }
    pointers.current.set(e.pointerId, p);

    if (mode.current === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d)));
      view.current = { scale, ox: mid.x - pinch.current.wx * scale, oy: mid.y - pinch.current.wy * scale };
      bump((n) => n + 1);
    } else if (mode.current === "pan") {
      view.current = { ...view.current, ox: start.current.ox + (p.x - start.current.x), oy: start.current.oy + (p.y - start.current.y) };
    } else if (mode.current === "paint") {
      if (last.current && (last.current.x !== c.x || last.current.y !== c.y)) {
        line(last.current, c);
        last.current = c;
      }
    } else if (mode.current === "select" && anchor.current) {
      setRegion(selectRect(anchor.current, c));
    }
    draw();
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (mode.current === "paint") endStroke();
    if (mode.current === "pinch" && pointers.current.size < 2) mode.current = null;
    else if (pointers.current.size === 0) mode.current = null;
    if (e.pointerType !== "mouse") hover.current = null;
    last.current = null;
    draw();
  };

  const setTool = (t: Tool) => setState({ tool: t });
  const toolBtn = (t: Tool, icon: string, label: string, key: string) => (
    <button className={`tool ${tool === t ? "on" : ""}`} onClick={() => setTool(t)} aria-pressed={tool === t} title={`${label} (${key})`}>
      <Icon name={icon} size={18} /><span>{label}</span>
    </button>
  );
  const zoomPct = map ? Math.round(view.current.scale) : 0;

  return (
    <div className="map-panel">
      <div className="toolbar">
        <div className="tool-group" role="toolbar" aria-label="Tools">
          {toolBtn("paint", "brush", "Paint", "B")}
          {toolBtn("erase", "eraser", "Erase", "E")}
          {toolBtn("select", "select", "Area", "S")}
          {toolBtn("pan", "hand", "Move", "H")}
        </div>
        <div className="tool-group">
          <button className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => wrap.current && zoomAt(1 / 1.3, wrap.current.clientWidth / 2, wrap.current.clientHeight / 2)}><Icon name="minus" /></button>
          <button className="icon-btn" aria-label="Fit to screen" title="Fit to screen" onClick={fit}><Icon name="fit" /></button>
          <button className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => wrap.current && zoomAt(1.3, wrap.current.clientWidth / 2, wrap.current.clientHeight / 2)}><Icon name="plus" /></button>
          <button className={`icon-btn ${showGrid ? "on" : ""}`} aria-label="Toggle grid" aria-pressed={showGrid} title="Grid (G)" onClick={() => setState({ showGrid: !showGrid })}><Icon name="grid" /></button>
        </div>
      </div>

      <div className="canvas-wrap" ref={wrap}>
        {map ? (
          <canvas
            ref={cv}
            className={`map-canvas tool-${tool}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => { hover.current = null; setInfo(""); draw(); }}
            onContextMenu={(e) => e.preventDefault()}
          />
        ) : (
          <EmptyMap />
        )}
      </div>

      {map && (
        <>
          <div className="statusbar">
            <BrushBadge />
            <span className="grow" />
            <span className="dim">{map.w} × {map.h} · {zoomPct}px · {info || "—"}</span>
          </div>
        </>
      )}
      <div className={`dock ${map ? "" : "nomap"}`}>
        <Palette />
        {map && <Layers />}
      </div>
    </div>
  );
}
