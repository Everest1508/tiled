import { useEffect, useMemo, useRef, useState } from "react";
import { generateMapWithClaude, generateVariantsWithClaude, refineMapWithClaude, regionLabel } from "../lib/ai";
import { buildCatalog } from "../lib/catalog";
import { renderToCanvas } from "../lib/render";
import { applySelectedVariant, isConnected, setState, useStore, AiTab } from "../lib/store";
import Icon from "./Icon";

const SIZES = [
  { label: "Small", ratio: "4:3", w: 32, h: 24 },
  { label: "Medium", ratio: "3:2", w: 48, h: 32 },
  { label: "Large", ratio: "4:3", w: 64, h: 48 },
  { label: "Wide", ratio: "16:9", w: 64, h: 36 },
  { label: "Panorama", ratio: "3:1", w: 60, h: 20 },
  { label: "Square", ratio: "1:1", w: 40, h: 40 },
  { label: "Tall", ratio: "2:3", w: 32, h: 48 },
];

const IDEAS = [
  "A riverside village with a market square, a forest to the north and a road leaving east",
  "A dungeon with five rooms joined by corridors, a treasure room and a boss chamber",
  "A forest clearing with a campfire, a winding path and a small pond",
  "An island with sandy beaches, palm trees and a small harbour",
];

const REFINES = ["Add more trees along the edges", "Make the river wider and add a bridge", "Add a fence around the houses", "Add a few flower patches and rocks"];

function Status() {
  const tilesets = useStore((s) => s.tilesets);
  const cat = useMemo(() => buildCatalog(tilesets), [tilesets]);
  const objects = Object.keys(cat.comps).length;
  const ok = cat.entries.length > 0;
  return (
    <div className={`catalog-status ${ok ? "ok" : "warn"}`}>
      <Icon name={ok ? "check" : "tiles"} size={16} />
      {ok ? (
        <span>{tilesets.length} {tilesets.length === 1 ? "tilesheet" : "tilesheets"} · {cat.entries.length} named tiles · {objects} objects</span>
      ) : (
        <span>Name some tiles first. Open the <button className="linklike" onClick={() => setState({ panel: "sheets" })}>Tilesheets</button> panel.</span>
      )}
    </div>
  );
}

function VariantThumb({ index }: { index: number }) {
  const variants = useStore((s) => s.variants);
  const tilesets = useStore((s) => s.tilesets);
  const host = useRef<HTMLDivElement>(null);
  const v = variants[index];
  useEffect(() => {
    const el = host.current;
    if (!el || !v) return;
    const draw = () => {
      const ts = tilesets[0];
      const cell = ts ? Math.max(8, Math.min(24, Math.floor(120 / Math.max(v.map.w, v.map.h)))) : 8;
      const cv = renderToCanvas(v.map, tilesets, cell);
      cv.className = "vthumb";
      el.replaceChildren(cv);
    };
    draw();
    const t = setTimeout(draw, 300); // after tilesheet images have decoded
    return () => clearTimeout(t);
  }, [v, tilesets]);
  return <div ref={host} className="vthumb-host" />;
}

function Generate() {
  const busy = useStore((s) => !!s.busy);
  const hasMap = useStore((s) => !!s.map);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState({ w: 32, h: 24 });
  const clamp = (n: number) => Math.max(8, Math.min(96, Math.floor(n) || 8));
  const ar = size.w / size.h;
  return (
    <>
      <Status />
      <label className="field">
        <span>Describe your map</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder="What should it look like? Mention places, paths, water, buildings and the mood." />
      </label>
      <div className="chips">
        {IDEAS.map((t) => <button key={t} className="chip idea" onClick={() => setPrompt(t)}>{t.split(",")[0]}</button>)}
      </div>

      <div className="field">
        <span>Proportion</span>
        <div className="sizes">
          {SIZES.map((s) => {
            const on = s.w === size.w && s.h === size.h;
            const r = s.w / s.h;
            return (
              <button key={s.label} className={`size ${on ? "on" : ""}`} onClick={() => setSize({ w: s.w, h: s.h })} aria-pressed={on}>
                <span className="shape" style={{ width: r >= 1 ? 30 : 30 * r, height: r >= 1 ? 30 / r : 30 }} />
                <strong>{s.label}</strong>
                <small>{s.ratio} · {s.w}×{s.h}</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="custom-size">
        <label><span>Width</span><input type="number" min={8} max={96} value={size.w} onChange={(e) => setSize({ ...size, w: clamp(Number(e.target.value)) })} /></label>
        <span className="times">×</span>
        <label><span>Height</span><input type="number" min={8} max={96} value={size.h} onChange={(e) => setSize({ ...size, h: clamp(Number(e.target.value)) })} /></label>
        <small className="dim">ratio {ar.toFixed(2)}:1 · up to 96</small>
      </div>

      <button className="btn primary wide big" disabled={busy || !prompt.trim()} onClick={() => generateMapWithClaude(prompt.trim(), size.w, size.h)}>
        <Icon name="sparkles" size={18} /> Generate map
      </button>
      {hasMap && <p className="hint">This replaces the current map. Undo (Ctrl+Z) brings it back.</p>}
    </>
  );
}

function Area() {
  const busy = useStore((s) => !!s.busy);
  const map = useStore((s) => s.map);
  const region = useStore((s) => s.region);
  const variants = useStore((s) => s.variants);
  const sel = useStore((s) => s.selVariant);
  const [count, setCount] = useState(4);
  const [prompt, setPrompt] = useState("");

  if (!map) return <p className="hint">Create or generate a map first, then come back to get alternatives for any part of it.</p>;
  return (
    <>
      <Status />
      <div className="region-card">
        <div>
          <strong>Area to redo</strong>
          <div className="dim">{regionLabel(region)}</div>
        </div>
        <button className="btn ghost" onClick={() => setState({ tool: "select", panel: "map" })}><Icon name="select" size={16} /> {region ? "Change" : "Select"}</button>
      </div>
      <p className="hint">Use the Area tool on the map and drag over the part you want to redo (up to 32 × 32 tiles).</p>

      <div className="field">
        <span>How many options</span>
        <div className="seg">
          {[2, 3, 4, 5, 6].map((n) => <button key={n} className={count === n ? "on" : ""} onClick={() => setCount(n)}>{n}</button>)}
        </div>
      </div>
      <label className="field">
        <span>What should be there? <small>(optional)</small></span>
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. a market square with stalls, or leave empty for variety" />
      </label>
      <button className="btn primary wide big" disabled={busy || !region} onClick={() => generateVariantsWithClaude(prompt, count)}>
        <Icon name="sparkles" size={18} /> Generate {count} options
      </button>

      {variants.length > 0 && (
        <>
          <div className="vgrid">
            {variants.map((v, i) => (
              <button key={i} className={`vcard ${i === sel ? "on" : ""}`} onClick={() => { setState({ selVariant: i }); }} aria-pressed={i === sel}>
                <VariantThumb index={i} />
                <span>{v.label}</span>
              </button>
            ))}
          </div>
          <p className="hint">The selected option is previewed on the map.</p>
          <div className="row">
            <button className="btn primary grow" disabled={busy || sel < 0} onClick={applySelectedVariant}><Icon name="check" size={16} /> Apply this option</button>
            <button className="btn ghost" onClick={() => setState({ variants: [], selVariant: -1 })}>Discard</button>
          </div>
        </>
      )}
    </>
  );
}

function Refine() {
  const busy = useStore((s) => !!s.busy);
  const map = useStore((s) => s.map);
  const [text, setText] = useState("");
  if (!map) return <p className="hint">Create or generate a map first, then ask Claude to change it.</p>;
  return (
    <>
      <Status />
      <label className="field">
        <span>What should change?</span>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the change. Everything else stays as it is." />
      </label>
      <div className="chips">
        {REFINES.map((t) => <button key={t} className="chip idea" onClick={() => setText(t)}>{t}</button>)}
      </div>
      <button className="btn primary wide big" disabled={busy || !text.trim()} onClick={() => refineMapWithClaude(text.trim())}>
        <Icon name="wand" size={18} /> Apply change
      </button>
      <p className="hint">The whole map is redrawn with your change. Undo restores the old version.</p>
    </>
  );
}

export default function AiPanel() {
  const tab = useStore((s) => s.aiTab);
  const hasKey = useStore(isConnected);
  const viaBridge = useStore((s) => s.settings.provider === "bridge");
  const tabs: { id: AiTab; label: string }[] = [
    { id: "generate", label: "Generate" },
    { id: "area", label: "Area" },
    { id: "refine", label: "Refine" },
  ];
  return (
    <div className="panel-body">
      {!hasKey && (
        <div className="connect-banner">
          <Icon name="key" size={18} />
          <div>
            <strong>{viaBridge ? "Claude Code is not connected" : "Connect an AI service"}</strong>
            <p>{viaBridge ? "Start Claude Code with the tile-studio server." : "Add a key for Claude, OpenAI, Groq, Gemini and more."}</p>
          </div>
          <button className="btn primary sm" onClick={() => setState({ settingsOpen: true })}>{viaBridge ? "Help" : "Connect"}</button>
        </div>
      )}
      <div className="seg wide">
        {tabs.map((t) => <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setState({ aiTab: t.id })}>{t.label}</button>)}
      </div>
      <div className="card">
        {tab === "generate" && <Generate />}
        {tab === "area" && <Area />}
        {tab === "refine" && <Refine />}
      </div>
    </div>
  );
}
