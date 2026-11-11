import { useState } from "react";
import { checkBridge } from "../lib/bridge";
import { listModels, testLLM } from "../lib/llm";
import { availableProviders, providerInfo, ProviderId } from "../lib/providers";
import { setProvider, setSettings, setState, useStore } from "../lib/store";
import Icon from "./Icon";

export default function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const settings = useStore((s) => s.settings);
  const bridge = useStore((s) => s.bridge);
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  if (!open) return null;

  const info = providerInfo(settings.provider);
  const viaBridge = info.format === "bridge";
  const viaHost = info.format === "sample";
  const models = Array.from(new Set([...loaded, ...info.models]));
  const close = () => setState({ settingsOpen: false });
  const pick = (id: ProviderId) => {
    setProvider(id);
    setResult(null);
    setLoaded([]);
  };
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      if (viaBridge) setResult(await checkBridge());
      else {
        await testLLM(settings);
        setResult({ ok: true, text: `Connected. ${info.label} is ready to help.` });
      }
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
    setTesting(false);
  };
  const loadModels = async () => {
    setLoadingModels(true);
    setResult(null);
    try {
      const ids = await listModels(settings);
      setLoaded(ids);
      setResult({ ok: true, text: ids.length ? `Found ${ids.length} models. Choose one from the list.` : "The service returned no models." });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
    setLoadingModels(false);
  };
  const ready = viaBridge || viaHost || (info.needsKey ? !!settings.apiKey.trim() : true);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-head">
          <h2 id="settings-title">{viaHost ? "AI settings" : "Connect an AI service"}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </div>

        {!viaHost && <div className="chips providers" role="radiogroup" aria-label="AI service">
          {availableProviders().map((p) => (
            <button key={p.id} role="radio" aria-checked={p.id === settings.provider} className={`chip ${p.id === settings.provider ? "on" : ""}`} onClick={() => pick(p.id)}>{p.label}</button>
          ))}
        </div>}
        <p className="note">{info.note}</p>

        {viaHost ? null : viaBridge ? (
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
              <li>Start <code>claude</code> in the repo folder and run <code>/tile-studio</code>. Keep it open.</li>
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
            {settings.provider === "custom" && (
              <label className="field">
                <span>Server address</span>
                <input value={settings.baseUrl} onChange={(e) => setSettings({ baseUrl: e.target.value })} spellCheck={false} placeholder="http://localhost:11434/v1" />
              </label>
            )}
            <label className="field">
              <span>{info.label} API key{!info.needsKey && " (optional)"}</span>
              <div className="input-row">
                <input
                  type={show ? "text" : "password"}
                  value={settings.apiKey}
                  placeholder={info.keyHint}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setSettings({ apiKey: e.target.value })}
                />
                <button className="btn ghost" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
              </div>
              {info.keyUrl && <small>Create a key at <a href={info.keyUrl} target="_blank" rel="noreferrer">{new URL(info.keyUrl).host}</a>.</small>}
            </label>

            <label className="check">
              <input type="checkbox" checked={settings.remember} onChange={(e) => setSettings({ remember: e.target.checked })} />
              <span>Remember keys on this device</span>
            </label>
            <p className="note">Keys stay in this browser and are only sent to the service you chose. Leave this off on shared computers.</p>

            <label className="field">
              <span>Model</span>
              <input value={settings.model} list="model-suggestions" onChange={(e) => setSettings({ model: e.target.value })} spellCheck={false} placeholder="Type a model id or load the list" />
              <datalist id="model-suggestions">{models.map((m) => <option key={m} value={m} />)}</datalist>
              <div className="row">
                <button className="btn ghost sm" onClick={loadModels} disabled={loadingModels || !ready}>{loadingModels ? "Loading…" : "Load models"}</button>
                <small className="dim">Model names change often. Any id your account can use works.</small>
              </div>
            </label>

            {models.length > 0 && (
              <div className="chips">
                {models.slice(0, 8).map((m) => <button key={m} className={`chip ${m === settings.model ? "on" : ""}`} onClick={() => setSettings({ model: m })}>{m.split("/").pop()}</button>)}
              </div>
            )}

            {settings.provider !== "custom" && (
              <details className="adv">
                <summary>Advanced</summary>
                <label className="field">
                  <span>Base URL</span>
                  <input value={settings.baseUrl} onChange={(e) => setSettings({ baseUrl: e.target.value })} spellCheck={false} />
                  <small>Change this only if you use your own proxy server.</small>
                </label>
              </details>
            )}
          </>
        )}

        {result && <div className={`result ${result.ok ? "ok" : "bad"}`}>{result.text}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={test} disabled={testing || !ready}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button className="btn primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
