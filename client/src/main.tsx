import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const shell = (window as unknown as { __GESTOR_SHELL?: boolean }).__GESTOR_SHELL === true;
if (shell) document.documentElement.classList.add("shell");
if (shell && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((list) => {
    for (const registration of list) void registration.unregister();
  });
} else if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // o ícone na tela inicial segue disponível sem o worker
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
