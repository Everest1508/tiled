import { useEffect, useMemo, useRef, useState } from "react";
import { nameSelectionWithClaude, nameTilesetWithClaude } from "../lib/ai";
import { getImage, loadImage } from "../lib/images";
import {
  addComp, addTilesetFiles, brushFromBlock, brushFromComp, notify, removeComp, removeTileset, setState, setTileName, updateTileset, useStore,
} from "../lib/store";
import { Comp, gridOf, Tileset } from "../lib/types";
import Icon from "./Icon";
import TileThumb from "./TileThumb";

interface Sel {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

const norm = (s: Sel) => ({ c0: Math.min(s.c0, s.c1), r0: Math.min(s.r0, s.r1), c1: Math.max(s.c0, s.c1), r1: Math.max(s.r0, s.r1) });

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 300, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function SheetCanvas({ ts, sel, onSel, blockMode }: { ts: Tileset; sel: Sel | null; onSel: (s: Sel | null) => void; blockMode: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const { w: width, h: height } = useSize(wrap);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [ready, setReady] = useState(!!getImage(ts));
  const drag = useRef<Sel | null>(null);
  const { cols, rows } = gridOf(ts);

  useEffect(() => {
    setReady(!!getImage(ts));
    loadImage(ts).then(() => setReady(true)).catch(() => {});
  }, [ts.id, ts.src]);

  // On desktop the sheet area has a fixed height, so "Fit" fits both ways; on phones only the width.
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1100px)").matches && height > 120;
  const fitRatio = Math.min(width / ts.width, wide ? height / ts.height : Infinity);
  const z = zoom === "fit" ? Math.min(8, Math.max(0.25, Math.floor(fitRatio * 4) / 4)) : zoom;
  const cw = Math.round(ts.width * z);
  const ch = Math.round(ts.height * z);

  useEffect(() => {
    const c = cv.current;
    const img = getImage(ts);
    if (!c || !img) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = cw * dpr;
    c.height = ch * dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.imageSmoothingEnabled = false;
    // checkerboard
    const s = 8;
    for (let y = 0; y < ch; y += s) for (let x = 0; x < cw; x += s) {
      g.fillStyle = ((x + y) / s) % 2 ? "#242836" : "#1d202b";
      g.fillRect(x, y, s, s);
    }
    g.drawImage(img, 0, 0, cw, ch);
    // grid
    g.strokeStyle = "rgba(255,255,255,.18)";
    g.lineWidth = 1;
    g.beginPath();
    for (let c0 = 0; c0 < cols * rows; c0++) {
      const x = ts.margin + (c0 % cols) * (ts.tw + ts.spacing);
      const y = ts.margin + Math.floor(c0 / cols) * (ts.th + ts.spacing);
      g.rect(Math.round(x * z) + 0.5, Math.round(y * z) + 0.5, Math.round(ts.tw * z) - 1, Math.round(ts.th * z) - 1);
    }
    g.stroke();
    // named tiles get a green corner
    g.fillStyle = "#35d49a";
    for (const k of Object.keys(ts.names)) {
      const id = Number(k);
      const x = ts.margin + (id % cols) * (ts.tw + ts.spacing);
      const y = ts.margin + Math.floor(id / cols) * (ts.th + ts.spacing);
      const px = Math.max(4, Math.min(8, ts.tw * z * 0.25));
      g.beginPath();
      g.moveTo(x * z + ts.tw * z, y * z);
      g.lineTo(x * z + ts.tw * z - px, y * z);
      g.lineTo(x * z + ts.tw * z, y * z + px);
      g.fill();
    }
    // objects get an orange outline
    g.strokeStyle = "#ffb454";
    g.lineWidth = 2;
    for (const comp of ts.comps) {
      const ids = comp.ids.filter((i) => i >= 0);
      if (!ids.length) continue;
      const cs = ids.map((i) => i % cols), rs = ids.map((i) => Math.floor(i / cols));
      const x0 = Math.min(...cs), x1 = Math.max(...cs), y0 = Math.min(...rs), y1 = Math.max(...rs);
      g.strokeRect((ts.margin + x0 * (ts.tw + ts.spacing)) * z + 1, (ts.margin + y0 * (ts.th + ts.spacing)) * z + 1,
        ((x1 - x0 + 1) * (ts.tw + ts.spacing) - ts.spacing) * z - 2, ((y1 - y0 + 1) * (ts.th + ts.spacing) - ts.spacing) * z - 2);
    }
    // selection
    if (sel) {
      const n = norm(sel);
      const x = (ts.margin + n.c0 * (ts.tw + ts.spacing)) * z;
      const y = (ts.margin + n.r0 * (ts.th + ts.spacing)) * z;
      const w = ((n.c1 - n.c0 + 1) * (ts.tw + ts.spacing) - ts.spacing) * z;
      const h = ((n.r1 - n.r0 + 1) * (ts.th + ts.spacing) - ts.spacing) * z;
      g.fillStyle = "rgba(124,92,255,.35)";
      g.fillRect(x, y, w, h);
      g.strokeStyle = "#b3a2ff";
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
  }, [ts, sel, z, cw, ch, ready, cols, rows]);

  const tileAt = (e: React.PointerEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * ts.width;
    const py = ((e.clientY - r.top) / r.height) * ts.height;
    const c = Math.floor((px - ts.margin) / (ts.tw + ts.spacing));
    const rr = Math.floor((py - ts.margin) / (ts.th + ts.spacing));
    return { c: Math.max(0, Math.min(cols - 1, c)), r: Math.max(0, Math.min(rows - 1, rr)) };
  };

  const usesPointer = (e: React.PointerEvent) => e.pointerType !== "touch" || blockMode;

  return (
    <div className="sheet-wrap">
      <div className="sheet-tools">
        <button className={`chip ${zoom === "fit" ? "on" : ""}`} onClick={() => setZoom("fit")}>Fit</button>
        {[1, 2, 3, 4].map((n) => <button key={n} className={`chip ${zoom === n ? "on" : ""}`} onClick={() => setZoom(n)}>{n}×</button>)}
        <span className="grow" />
        <small className="dim">{cols} × {rows} = {cols * rows} tiles</small>
      </div>
      <div className="sheet-scroll" ref={wrap}>
        <canvas
          ref={cv}
          className="sheet-canvas"
          style={{ width: cw, height: ch, touchAction: blockMode ? "none" : "pan-x pan-y" }}
          onPointerDown={(e) => {
            if (!usesPointer(e)) return;
            (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
            const t = tileAt(e);
            drag.current = { c0: t.c, r0: t.r, c1: t.c, r1: t.r };
            onSel(drag.current);
          }}
          onPointerMove={(e) => {
            if (!drag.current || !usesPointer(e)) return;
            const t = tileAt(e);
            if (t.c !== drag.current.c1 || t.r !== drag.current.r1) {
              drag.current = { ...drag.current, c1: t.c, r1: t.r };
              onSel(drag.current);
            }
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onClick={(e) => {
            if (e.detail === 0 || (e.nativeEvent as PointerEvent).pointerType !== "touch" || blockMode) return;
            const t = tileAt(e);
            onSel({ c0: t.c, r0: t.r, c1: t.c, r1: t.r });
          }}
        />
      </div>
    </div>
  );
}

function NameRow({ ts, id }: { ts: Tileset; id: number }) {
  const [v, setV] = useState(ts.names[id] ?? "");
  useEffect(() => setV(ts.names[id] ?? ""), [ts.names[id]]);
  return (
    <div className="name-row">
      <TileThumb ts={ts} local={id} size={32} />
      <span className="id">#{id}</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { const f = setTileName(ts.id, id, v); setV(f); }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label={`Name of tile ${id}`}
        spellCheck={false}
      />
    </div>
  );
}

function NumberField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (n: number) => void }) {
  return (
    <label className="num">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={min} value={value} onChange={(e) => {
        const n = Math.floor(Number(e.target.value));
        if (Number.isFinite(n) && n >= min) onChange(n);
      }} />
    </label>
  );
}

function Detail({ ts }: { ts: Tileset }) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [blockMode, setBlockMode] = useState(false);
  const [name, setName] = useState("");
  const [hint, setHint] = useState("");
  const [search, setSearch] = useState("");
  const { cols } = gridOf(ts);
  const busy = useStore((s) => !!s.busy);

  useEffect(() => { setSel(null); setName(""); }, [ts.id]);
  const n = sel ? norm(sel) : null;
  const single = !!n && n.c0 === n.c1 && n.r0 === n.r1;
  const local = n ? n.r0 * cols + n.c0 : -1;
  useEffect(() => {
    if (single) setName(ts.names[local] ?? "");
    else setName("");
  }, [sel?.c0, sel?.r0, sel?.c1, sel?.r1, ts.id]);

  const named = useMemo(
    () => Object.entries(ts.names).map(([k, v]) => [Number(k), v] as const).filter(([, v]) => v.includes(search.trim().toLowerCase())).sort((a, b) => a[0] - b[0]),
    [ts.names, search],
  );

  const useBrush = () => {
    if (!n) return;
    const brush = brushFromBlock(ts, n.c0, n.r0, n.c1, n.r1);
    setState({ brush, tool: "paint" });
    notify(`Brush: ${brush.label}. Open the map and draw.`, "ok");
    if (window.matchMedia("(max-width: 1099px)").matches) setState({ panel: "map" });
  };

  const save = () => {
    if (!n) return;
    if (single) {
      const f = setTileName(ts.id, local, name);
      setName(f);
      notify(f ? `Tile named "${f}".` : "Name cleared.", "ok");
    } else {
      const ids: number[] = [];
      for (let r = n.r0; r <= n.r1; r++) for (let c = n.c0; c <= n.c1; c++) ids.push(r * cols + c);
      const comp: Comp = { name, cols: n.c1 - n.c0 + 1, rows: n.r1 - n.r0 + 1, ids };
      if (!name.trim()) return notify("Type a name for this object first.", "error");
      addComp(ts.id, comp);
      notify(`Saved object "${name.trim().toLowerCase().replace(/\s+/g, "_")}". AI can now place it as one piece.`, "ok");
    }
  };

  const suggest = async () => {
    if (!n) return;
    const s = await nameSelectionWithClaude(ts.id, n.c0, n.r0, n.c1, n.r1);
    if (s) setName(s);
  };

  return (
    <div className="sheet-editor">
      <div className="se-col se-left">
      <div className="card o1">
        <div className="row">
          <input className="grow strong" value={ts.name} onChange={(e) => updateTileset(ts.id, { name: e.target.value })} aria-label="Tilesheet name" />
          <button className="icon-btn danger" aria-label="Remove tilesheet" title="Remove tilesheet" onClick={() => confirm(`Remove "${ts.name}" and the tiles from it used on the map?`) && removeTileset(ts.id)}>
            <Icon name="trash" />
          </button>
        </div>
        <div className="grid4">
          <NumberField label="Tile W" min={1} value={ts.tw} onChange={(v) => updateTileset(ts.id, { tw: v })} />
          <NumberField label="Tile H" min={1} value={ts.th} onChange={(v) => updateTileset(ts.id, { th: v })} />
          <NumberField label="Margin" min={0} value={ts.margin} onChange={(v) => updateTileset(ts.id, { margin: v })} />
          <NumberField label="Spacing" min={0} value={ts.spacing} onChange={(v) => updateTileset(ts.id, { spacing: v })} />
        </div>
        <p className="hint">Tile size must match the grid of your image. The green corners below show which tiles already have a name.</p>
      </div>

      <div className="card ai-card o4">
        <h3><Icon name="sparkles" size={16} /> Name everything with AI</h3>
        <p className="hint">The AI looks at the whole sheet, names every tile and finds multi-tile objects like houses and trees. You can fix any name afterwards.</p>
        <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Optional hint: top-down village, 3×3 houses, road turns…" />
        <button className="btn primary wide" disabled={busy} onClick={() => nameTilesetWithClaude(ts.id, hint)}>
          <Icon name="wand" size={16} /> Name tiles with AI
        </button>
      </div>

      {ts.comps.length > 0 && (
        <div className="card o5">
          <h3>Objects <span className="count">{ts.comps.length}</span></h3>
          <div className="chips">
            {ts.comps.map((c) => (
              <span className="obj" key={c.name}>
                <button className="obj-main" title="Use as brush" onClick={() => { setState({ brush: brushFromComp(ts, c), tool: "paint" }); notify(`Brush: ${c.name}`, "ok"); }}>
                  {c.name} <small>{c.cols}×{c.rows}</small>
                </button>
                <button className="obj-x" aria-label={`Remove ${c.name}`} onClick={() => removeComp(ts.id, c.name)}><Icon name="close" size={14} /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      </div>
      <div className="se-col se-center">
      <div className="card o2 sheet-card">
        <div className="row between">
          <h3>Tilesheet</h3>
          <label className="switch" title="Lets you drag to select a block of tiles with your finger">
            <input type="checkbox" checked={blockMode} onChange={(e) => setBlockMode(e.target.checked)} />
            <span>Block select (touch)</span>
          </label>
        </div>
        <SheetCanvas ts={ts} sel={sel} onSel={setSel} blockMode={blockMode} />
      </div>
      </div>
      <div className="se-col se-right">
      <div className="card o3">
        <h3>Selected</h3>
        <div className="selbox">
          {!n ? (
            <p className="hint">Tap a tile to name it. Drag over several tiles (a house, a tree) to save them as one object.</p>
          ) : (
            <>
              <div className="sel-head">
                {single ? <TileThumb ts={ts} local={local} size={36} /> : <span className="blockbadge">{n.c1 - n.c0 + 1}×{n.r1 - n.r0 + 1}</span>}
                <strong>{single ? `Tile #${local}` : `Block of ${(n.c1 - n.c0 + 1) * (n.r1 - n.r0 + 1)} tiles`}</strong>
              </div>
              <div className="input-row">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={single ? "e.g. grass, road_turn_ne" : "e.g. house, oak_tree"} onKeyDown={(e) => e.key === "Enter" && save()} spellCheck={false} />
                <button className="btn ghost" onClick={suggest} disabled={busy} title="Let the AI look at the selection and suggest a name"><Icon name="sparkles" size={16} /> Suggest</button>
              </div>
              <div className="row wrap">
                <button className="btn primary" onClick={save}>{single ? "Save name" : "Save as object"}</button>
                <button className="btn ghost" onClick={useBrush}><Icon name="brush" size={16} /> Use as brush</button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="card o6">
        <div className="row between">
          <h3>Named tiles <span className="count">{Object.keys(ts.names).length}</span></h3>
          {Object.keys(ts.names).length > 6 && <input className="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search names" />}
        </div>
        {named.length === 0 ? <p className="hint">Nothing named yet.</p> : (
          <div className="names">
            {named.slice(0, 120).map(([id]) => <NameRow key={id} ts={ts} id={id} />)}
            {named.length > 120 && <p className="hint">Showing the first 120. Use search to find others.</p>}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/** A real file input laid invisibly over its parent, so a tap lands on the input itself (most reliable in embedded webviews). */
function FilePicker({ label = "Choose tilesheet images" }: { label?: string }) {
  return (
    <input
      type="file"
      accept="image/*,.png,.jpg,.jpeg,.gif,.webp"
      multiple
      className="file-cover"
      aria-label={label}
      title={label}
      onChange={(e) => {
        const list = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(f.name));
        if (list.length) addTilesetFiles(list);
        e.target.value = "";
      }}
    />
  );
}

export default function SheetsPanel() {
  const tilesets = useStore((s) => s.tilesets);
  const activeId = useStore((s) => s.activeTilesetId);
  const [over, setOver] = useState(false);
  const active = tilesets.find((t) => t.id === activeId) ?? tilesets[0];

  useEffect(() => {
    // Pasting an image also adds it, for places where the file picker is unavailable.
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length && !(e.target as HTMLElement)?.closest?.("input, textarea")) addTilesetFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const pick = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (list.length) addTilesetFiles(list);
  };

  return (
    <div
      className={`panel-body ${over ? "dropping" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
    >
      {tilesets.length === 0 ? (
        <div className="dropzone">
          <FilePicker />
          <span className="dz-icon"><Icon name="upload" size={28} /></span>
          <strong>Add your tilesheets</strong>
          <span>Drop PNG images here or tap to browse. You can add as many sheets as you like.</span>
        </div>
      ) : (
        <>
          <div className="sheet-tabs" role="tablist">
            {tilesets.map((t) => (
              <button key={t.id} role="tab" aria-selected={t.id === active?.id} className={`tab ${t.id === active?.id ? "on" : ""}`} onClick={() => setState({ activeTilesetId: t.id })}>
                {t.name}
              </button>
            ))}
            <div className="tab add" aria-label="Add tilesheet"><Icon name="plus" size={16} /><FilePicker label="Add tilesheet" /></div>
          </div>
          {active && <Detail ts={active} />}
        </>
      )}
    </div>
  );
}
