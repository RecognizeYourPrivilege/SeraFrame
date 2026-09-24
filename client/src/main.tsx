import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

async function boot() {
  const useMocks = import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS !== "false";
  if (useMocks) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }

  const root = document.getElementById("root");
  if (!root) throw new Error("Root element missing");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot().catch((err: unknown) => {
  const root = document.getElementById("root");
  const message = err instanceof Error ? err.message : "Failed to start";
  if (root) root.textContent = message;
});
