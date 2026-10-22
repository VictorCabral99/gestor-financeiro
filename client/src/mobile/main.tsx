import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "../index.css";
import "./mobile.css";

document.documentElement.classList.add("shell");

if (window.location.pathname.endsWith("/mobile.html")) {
  const next = window.location.pathname.replace(/mobile\.html$/, "") || "/";
  window.history.replaceState(null, "", next + window.location.search + window.location.hash);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
