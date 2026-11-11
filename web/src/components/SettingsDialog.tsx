import { useState } from "react";
import { MODELS, testConnection } from "../lib/claude";
import { setSettings, setState, useStore } from "../lib/store";
import Icon from "./Icon";

export default function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const settings = useStore((s) => s.settings);
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  if (!open) return null;

  const close = () => setState({ settingsOpen: false });
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      await testConnection(settings);
      setResult({ ok: true, text: "Connected. Claude is ready to help." });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
    setTesting(false);
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-head">
          <h2 id="settings-title">Connect to Claude</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </div>

        <label className="field">
          <span>Claude API key</span>
          <div className="input-row">
            <input
              type={show ? "text" : "password"}
              value={settings.apiKey}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setSettings({ apiKey: e.target.value })}
            />
            <button className="btn ghost" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
          </div>
          <small>
            Create a key in the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic Console</a>.
          </small>
        </label>

        <label className="check">
          <input type="checkbox" checked={settings.remember} onChange={(e) => setSettings({ remember: e.target.checked })} />
          <span>Remember the key on this device</span>
        </label>
        <p className="note">
          Your key stays in this browser and is only sent to the API address below. Anyone using this browser profile could read it, so leave this off on shared computers.
        </p>

        <label className="field">
          <span>Model</span>
          <select value={settings.model} onChange={(e) => setSettings({ model: e.target.value })}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            {!MODELS.some((m) => m.id === settings.model) && <option value={settings.model}>{settings.model}</option>}
          </select>
        </label>

        <details className="adv">
          <summary>Advanced</summary>
          <label className="field">
            <span>API base URL</span>
            <input value={settings.baseUrl} onChange={(e) => setSettings({ baseUrl: e.target.value })} spellCheck={false} />
            <small>Change this only if you use your own proxy server that adds the key for you.</small>
          </label>
          <label className="field">
            <span>Custom model id</span>
            <input value={settings.model} onChange={(e) => setSettings({ model: e.target.value })} spellCheck={false} />
          </label>
        </details>

        {result && <div className={`result ${result.ok ? "ok" : "bad"}`}>{result.text}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={test} disabled={testing || !settings.apiKey.trim()}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button className="btn primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
