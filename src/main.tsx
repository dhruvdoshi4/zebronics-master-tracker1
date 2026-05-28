import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

const CHUNK_RELOAD_ONCE_KEY = "__zmt_chunk_reload_once__";

function reloadOnceForStaleChunk(reason: unknown): void {
  const serialized = String(reason ?? "").toLowerCase();
  const isChunkError =
    serialized.includes("failed to fetch dynamically imported module") ||
    serialized.includes("loading chunk") ||
    serialized.includes("dynamically imported module");
  if (!isChunkError) return;
  if (sessionStorage.getItem(CHUNK_RELOAD_ONCE_KEY) === "1") return;
  sessionStorage.setItem(CHUNK_RELOAD_ONCE_KEY, "1");
  window.location.reload();
}

window.addEventListener("vite:preloadError", (event) => {
  const custom = event as Event & { payload?: unknown };
  reloadOnceForStaleChunk(custom.payload ?? event);
});

window.addEventListener("unhandledrejection", (event) => {
  reloadOnceForStaleChunk(event.reason);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
