import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import "./styles/app.css";

if (isTauri()) {
  document.addEventListener(
    "contextmenu",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : document.elementFromPoint(event.clientX, event.clientY);
      if (target?.closest("[data-grid-image-task-id]")) {
        return;
      }

      event.preventDefault();
    },
    { capture: true },
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
