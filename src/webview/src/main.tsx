import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./main.css";

// Placeholder shell: the real chat UI (App routes, messenger, strings) is
// built in todos 11+. This mount exists only so the Vite pipeline emits a
// meaningful main.js/main.css pair.
function App() {
  return (
    <main className="p-4 text-sm">
      <h1 className="mb-2 text-base font-semibold">OpenCode Panel</h1>
      <p>Build pipeline placeholder &mdash; chat UI arrives in later todos.</p>
      {__DEV__ ? <p className="mt-2 opacity-60">dev build (__DEV__)</p> : null}
    </main>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("webview root element missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
