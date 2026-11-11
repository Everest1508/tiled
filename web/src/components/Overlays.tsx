import { cancelAi } from "../lib/ai";
import { useStore } from "../lib/store";
import Icon from "./Icon";

export function Toasts() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
      <Icon name={toast.kind === "error" ? "close" : toast.kind === "ok" ? "check" : "sparkles"} size={16} />
      <span>{toast.text}</span>
    </div>
  );
}

export function BusyBar() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busybar" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div className="busytext">
        <strong>{busy.label}</strong>
        <small>{busy.chars > 0 ? `${busy.chars.toLocaleString()} characters received` : "Waiting for Claude…"}</small>
      </div>
      <button className="btn ghost sm" onClick={cancelAi}>Cancel</button>
    </div>
  );
}
