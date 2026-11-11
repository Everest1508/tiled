import { useEffect } from "react";
import AiPanel from "./components/AiPanel";
import Header from "./components/Header";
import Icon from "./components/Icon";
import MapView from "./components/MapView";
import { BusyBar, Toasts } from "./components/Overlays";
import SettingsDialog from "./components/SettingsDialog";
import SheetsPanel from "./components/SheetsPanel";
import { applyBridgeSettings } from "./lib/bridge";
import { getState, Panel, redo, setState, undo, useStore } from "./lib/store";

export default function App() {
  const panel = useStore((s) => s.panel);
  const theme = useStore((s) => s.theme);
  const busy = useStore((s) => !!s.busy);
  const provider = useStore((s) => s.settings.provider);
  const bridgeUrl = useStore((s) => s.settings.bridgeUrl);

  useEffect(() => {
    applyBridgeSettings();
  }, [provider, bridgeUrl]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0f1117" : "#f4f6fb");
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "b") setState({ tool: "paint" });
        else if (k === "e") setState({ tool: "erase" });
        else if (k === "s") setState({ tool: "select" });
        else if (k === "h") setState({ tool: "pan" });
        else if (k === "g") setState({ showGrid: !getState().showGrid });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tabs: { id: Panel; label: string; icon: string }[] = [
    { id: "sheets", label: "Tilesheets", icon: "tiles" },
    { id: "map", label: "Map", icon: "map" },
    { id: "ai", label: "Claude", icon: "sparkles" },
  ];

  return (
    <div className="app">
      <Header />
      <main className={`workspace show-${panel}`}>
        <section className="panel sheets" aria-label="Tilesheets">
          <div className="panel-title"><Icon name="tiles" size={16} /> Tilesheets</div>
          <SheetsPanel />
        </section>
        <section className="panel map" aria-label="Map">
          <MapView />
        </section>
        <section className="panel ai" aria-label="Claude">
          <div className="panel-title"><Icon name="sparkles" size={16} /> Claude</div>
          <AiPanel />
        </section>
      </main>

      <nav className="bottom-nav" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.id} className={panel === t.id ? "on" : ""} onClick={() => setState({ panel: t.id })} aria-current={panel === t.id}>
            <Icon name={t.icon} size={20} />
            <span>{t.label}</span>
            {t.id === "ai" && busy && <i className="pulse" />}
          </button>
        ))}
      </nav>

      <BusyBar />
      <Toasts />
      <SettingsDialog />
    </div>
  );
}
