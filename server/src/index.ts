import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { errorHandler } from "./lib/http.js";
import { ensurePasswordHash, listenBlockReason } from "./auth.js";
import { requireBridgeSession, authRouter } from "./routes/sync.js";
import { syncRouter } from "./routes/sync.js";
import { accountsRouter } from "./routes/accounts.js";
import { adjustmentsRouter } from "./routes/adjustments.js";
import { backupRouter } from "./routes/backup.js";
import { cardsRouter } from "./routes/cards.js";
import { categoriesRouter } from "./routes/categories.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { expenseRulesRouter } from "./routes/expenseRules.js";
import { expensesRouter } from "./routes/expenses.js";
import { incomesRouter } from "./routes/incomes.js";
import { invoicesRouter, monthsRouter } from "./routes/months.js";
import { profilesRouter } from "./routes/profiles.js";
import { reservesRouter } from "./routes/reserves.js";
import { seedRouter } from "./routes/seed.js";
import { transfersRouter } from "./routes/transfers.js";
import { syncMonths } from "./services/months.js";
import { refreshAllInvoiceDates } from "./services/invoices.js";
import { db, forEachProfile, runWithProfile } from "./db.js";
import { resolveProfileId } from "./profiles.js";
import { clientDistDir } from "./paths.js";
import { syncWithBridge } from "./sync/bridgeClient.js";

const app = express();
const PORT = Number(process.env.PORT) || 3333;
const HOST = process.env.HOST || "127.0.0.1";

app.set("trust proxy", 1);
app.use(cors({ origin: true }));
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "gestor-financeiro" });
});

app.use("/api", requireBridgeSession);
app.use("/api/auth", authRouter);

/** Rotas de perfil não dependem do banco do usuário ativo. */
app.use("/api/profiles", profilesRouter);

/** Isola cada request no SQLite do perfil (header X-Profile-Id). */
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/profiles")) {
    next();
    return;
  }
  const profileId = resolveProfileId(req.header("X-Profile-Id"));
  runWithProfile(profileId, () => next());
});

app.use("/api/accounts", accountsRouter);
app.use("/api/account-adjustments", adjustmentsRouter);
app.use("/api/account-transfers", transfersRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/card-invoices", invoicesRouter);
app.use("/api/reserves", reservesRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/months", monthsRouter);
app.use("/api/incomes", incomesRouter);
app.use("/api/expense-rules", expenseRulesRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/seed", seedRouter);
app.use("/api/backup", backupRouter);
app.use("/api/sync", syncRouter);

const hasClientBuild = fs.existsSync(path.join(clientDistDir, "index.html"));
if (hasClientBuild) {
  app.use(express.static(clientDistDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDistDir, "index.html"));
  });
}

app.use(errorHandler);

ensurePasswordHash();
const blocked = listenBlockReason(HOST);
if (blocked) {
  console.error(blocked);
  process.exit(1);
}

forEachProfile((profile) => {
  const sync = syncMonths();
  console.log(
    `[sync:${profile.name}] mês atual ${sync.current_month}; abertos: ${sync.generated_for.join(", ") || "-"}`,
  );
  const refreshed = refreshAllInvoiceDates();
  console.log(
    `[invoices:${profile.name}] datas: ${refreshed.changed} alterada(s) de ${refreshed.total}`,
  );
  db.checkpointWal();
});

app.listen(PORT, HOST, () => {
  console.log(`Gestor Financeiro API em http://${HOST}:${PORT}`);
  if (hasClientBuild) {
    console.log(`UI (build) em http://${HOST}:${PORT}`);
  }
  if (process.env.GESTOR_ROLE !== "bridge") {
    const timer = setInterval(() => {
      syncWithBridge().catch((err) => {
        console.error("[sync]", err instanceof Error ? err.message : err);
      });
    }, 20_000);
    timer.unref();
    syncWithBridge().catch((err) => {
      console.error("[sync]", err instanceof Error ? err.message : err);
    });
  }
});
