import { useState } from "react";
import { checkBridge } from "../lib/bridge";
import { MODELS, testConnection } from "../lib/claude";
import { setSettings, setState, useStore } from "../lib/store";
import Icon from "./Icon";

export default function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const settings = useStore((s) => s.settings);
  const bridge = useStore((s) => s.bridge);
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  if (!open) return null;

  const close = () => setState({ settingsOpen: false });
  const viaBridge = settings.provider === "bridge";
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      if (viaBridge) {
        const r = await checkBridge();
        setResult(r);
        setTesting(false);
        return;
      }
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

        <div className="seg wide">
          <button className={!viaBridge ? "on" : ""} onClick={() => setSettings({ provider: "api" })}>API key</button>
          <button className={viaBridge ? "on" : ""} onClick={() => setSettings({ provider: "bridge" })}>Claude Code</button>
        </div>

        {viaBridge ? (
          <>
            <p className="note">
              Use your Claude Code subscription instead of an API key. Claude Code runs on your computer with the tile-studio MCP server and does the work when you press a Claude button here.
            </p>
            <div className={`result ${bridge === "connected" ? "ok" : "bad"}`}>
              {bridge === "connected" ? "Connected to Claude Code." : bridge === "connecting" ? "Looking for the bridge…" : "Not connected."}
            </div>
            <ol className="bridge-steps">
              <li>Install Node 20+ and Claude Code on your computer.</li>
              <li>Add the server once: <code>claude mcp add tile-studio -- node /path/to/tiled/bridge/server.mjs</code></li>
              <li>Start <code>claude</code> in any folder and run <code>/tile-studio</code>. Keep it open.</li>
              <li>Use this page on the same computer. Press a Claude button and Claude Code takes the job.</li>
            </ol>
            <details className="adv" open={bridge !== "connected"}>
              <summary>Bridge address</summary>
              <label className="field">
                <span>Address</span>
                <input value={settings.bridgeUrl} onChange={(e) => setSettings({ bridgeUrl: e.target.value })} spellCheck={false} />
                <small>Default is http://127.0.0.1:8787. It only works on the computer that runs Claude Code.</small>
              </label>
            </details>
          </>
        ) : (
          <>
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

          </>
        )}

        {result && <div className={`result ${result.ok ? "ok" : "bad"}`}>{result.text}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={test} disabled={testing || (!viaBridge && !settings.apiKey.trim())}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button className="btn primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
