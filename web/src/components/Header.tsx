import { useRef, useState } from "react";
import { providerInfo } from "../lib/providers";
import { isConnected, exportPng, exportTilesetImages, exportTmj, openProject, redo, saveProject, setState, setTheme, undo, useStore } from "../lib/store";
import Icon from "./Icon";

export default function Header() {
  const name = useStore((s) => s.projectName);
  const hasMap = useStore((s) => !!s.map);
  const canUndo = useStore((s) => s.history.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const theme = useStore((s) => s.theme);
  const hasKey = useStore(isConnected);
  const viaBridge = useStore((s) => s.settings.provider === "bridge");
  const providerName = useStore((s) => providerInfo(s.settings.provider).label);
  const hasSheets = useStore((s) => s.tilesets.length > 0);
  const [menu, setMenu] = useState(false);
  const openRef = useRef<HTMLInputElement>(null);

  const item = (label: string, icon: string, fn: () => void, disabled = false) => (
    <button className="menu-item" disabled={disabled} onClick={() => { setMenu(false); fn(); }}>
      <Icon name={icon} size={16} /> {label}
    </button>
  );

  return (
    <header className="header">
      <div className="brand">
        <span className="logo" aria-hidden="true"><Icon name="tiles" size={18} /></span>
        <span className="brand-name">Tile Map Studio</span>
      </div>

      <input className="project-name" value={name} onChange={(e) => setState({ projectName: e.target.value })} aria-label="Project name" />

      <div className="header-actions">
        <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo"><Icon name="undo" /></button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo"><Icon name="redo" /></button>

        <div className="menu-wrap">
          <button className="btn ghost" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu">
            <Icon name="download" size={16} /> <span className="hide-sm">Export</span>
          </button>
          {menu && (
            <>
              <div className="menu-back" onClick={() => setMenu(false)} />
              <div className="menu" role="menu">
                {item("Tiled map (.tmj)", "map", exportTmj, !hasMap)}
                {item("Tilesheet images (.png)", "image", exportTilesetImages, !hasSheets)}
                {item("Map picture (.png)", "image", exportPng, !hasMap)}
                <hr />
                {item("Save project file", "download", saveProject, !hasSheets && !hasMap)}
                {item("Open project file…", "folder", () => openRef.current?.click())}
              </div>
            </>
          )}
        </div>
        <input
          ref={openRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openProject(f);
            e.target.value = "";
          }}
        />

        <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme" title="Toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button className={`btn ${hasKey ? "ghost" : "primary"} connect`} onClick={() => setState({ settingsOpen: true })}>
          <span className={`dot ${hasKey ? "on" : ""}`} />
          <Icon name="key" size={16} />
          <span className="hide-sm">{hasKey ? `${providerName} connected` : viaBridge ? "Claude Code offline" : "Connect AI"}</span>
        </button>
      </div>
    </header>
  );
}

