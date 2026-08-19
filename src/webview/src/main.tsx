import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./app/bootstrap";
import "./main.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("webview root element missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
