import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { LoginScreen } from "../components/LoginScreen";
import { ProfileSwitcher } from "../components/ProfileSwitcher";
import { QueueBanner } from "../components/QueueBanner";
import { setConcealValues } from "../lib/format";
import { ProfilesProvider } from "../lib/profiles";
import { warmLocalCopy } from "../lib/warm";
import { ExpensesPage } from "../pages/ExpensesPage";
import { HistoryPage } from "../pages/HistoryPage";
import { InvoicesPage } from "../pages/InvoicesPage";
import { MonthPage } from "../pages/MonthPage";
import { SetupPage } from "../pages/SetupPage";
import { YearPage } from "../pages/YearPage";
import { QuickAdd } from "./QuickAdd";

function nativeBridge() {
  return (
    window as unknown as {
      GestorAndroid?: { openAccount?: () => void; checkUpdate?: () => void };
    }
  ).GestorAndroid;
}

function Eye() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.9 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.1" />
      <path d="M6.1 6.1C3.8 7.8 2 12 2 12s3.5 6 10 6c1.3 0 2.5-.3 3.6-.8" />
    </svg>
  );
}

function TabGlyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

type Gate = "loading" | "login" | "app";

const VALUES_HIDDEN = "gestor.valuesHidden";

function Shell() {
  const [more, setMore] = useState(false);
  const [hidden, setHidden] = useState(
    () => localStorage.getItem(VALUES_HIDDEN) === "1",
  );
  setConcealValues(hidden);
  document.documentElement.classList.toggle("values-hidden", hidden);

  function toggleValues() {
    const next = !hidden;
    localStorage.setItem(VALUES_HIDDEN, next ? "1" : "0");
    setHidden(next);
  }

  useEffect(() => {
    void warmLocalCopy();
  }, []);

  return (
    <ProfilesProvider>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <strong>Gestor Financeiro</strong>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="eye-toggle"
              aria-pressed={hidden}
              aria-label={hidden ? "Exibir valores" : "Esconder valores"}
              onClick={toggleValues}
            >
              {hidden ? <EyeOff /> : <Eye />}
            </button>
            <ProfileSwitcher />
          </div>
        </header>

        <QueueBanner />

        <Routes>
          <Route path="/" element={<MonthPage />} />
          <Route path="/despesas" element={<ExpensesPage />} />
          <Route path="/ano" element={<YearPage />} />
          <Route path="/faturas" element={<InvoicesPage />} />
          <Route path="/cadastros" element={<SetupPage />} />
          <Route path="/historico" element={<HistoryPage />} />
        </Routes>

        {more && (
          <button className="more-backdrop" type="button" aria-label="Fechar" onClick={() => setMore(false)} />
        )}
        {more && (
          <div className="more-sheet">
            <p>Mais</p>
            <NavLink to="/cadastros" onClick={() => setMore(false)}>
              Cadastros
            </NavLink>
            <NavLink to="/historico" onClick={() => setMore(false)}>
              Histórico
            </NavLink>
            <button type="button" onClick={() => nativeBridge()?.openAccount?.()}>
              Conta do computador
            </button>
            <button type="button" onClick={() => nativeBridge()?.checkUpdate?.()}>
              Buscar atualização
            </button>
          </div>
        )}

        <nav className="tabbar" aria-label="Seções">
          <NavLink to="/" end onClick={() => setMore(false)}>
            <TabGlyph d="M4 11.2 12 4l8 7.2V20H15.2v-6.2h-6.4V20H4z" />
            <span>Início</span>
          </NavLink>
          <NavLink to="/despesas" onClick={() => setMore(false)}>
            <TabGlyph d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" />
            <span>Mov</span>
          </NavLink>
          <NavLink to="/faturas" onClick={() => setMore(false)}>
            <TabGlyph d="M3 7.5h18v11H3zM3 11.5h18" />
            <span>Cartões</span>
          </NavLink>
          <NavLink to="/ano" onClick={() => setMore(false)}>
            <TabGlyph d="M5 5h14v15H5zM5 9.5h14M9 3.5v3M15 3.5v3" />
            <span>Ano</span>
          </NavLink>
          <button type="button" className={more ? "active" : ""} onClick={() => setMore((open) => !open)}>
            <TabGlyph d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" />
            <span>Mais</span>
          </button>
        </nav>
        {!more && <QuickAdd />}
      </div>
    </ProfilesProvider>
  );
}

export default function App() {
  const [gate, setGate] = useState<Gate>("loading");

  useEffect(() => {
    let cancel = false;
    async function check() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (cancel) return;
        if (res.status === 401) {
          setGate("login");
          return;
        }
        setGate("app");
      } catch {
        if (!cancel) setGate("app");
      }
    }
    void check();
    const onUnauthorized = () => setGate("login");
    const onSynced = () => {
      if (!document.querySelector(".modal-backdrop")) window.location.reload();
    };
    window.addEventListener("gestor-unauthorized", onUnauthorized);
    window.addEventListener("gestor-synced", onSynced);
    return () => {
      cancel = true;
      window.removeEventListener("gestor-unauthorized", onUnauthorized);
      window.removeEventListener("gestor-synced", onSynced);
    };
  }, []);

  if (gate === "loading") {
    return <p className="login-screen muted">Abrindo…</p>;
  }
  if (gate === "login") {
    return <LoginScreen onDone={() => setGate("app")} />;
  }
  return <Shell />;
}
