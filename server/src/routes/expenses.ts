import { Router } from "express";
import { db } from "../db.js";
import { notFound, validateBody } from "../lib/http.js";
import {
  expenseCreateSchema,
  expensePaySchema,
  expenseUpdateSchema,
} from "../lib/schemas.js";
import {
  createExpense,
  deleteExpenseScoped,
  payExpense,
  unpayExpense,
  updateExpense,
} from "../services/expenses.js";
import {
  listExpensesForLens,
  parseBasis,
  parseChannel,
} from "../services/ledger.js";

export const expensesRouter = Router();

expensesRouter.get("/", (req, res) => {
  const month = req.query.month as string | undefined;
  const hasLens =
    req.query.channel != null ||
    req.query.canal != null ||
    req.query.basis != null ||
    req.query.base != null;

  if (month && hasLens) {
    const channel = parseChannel(req.query.channel ?? req.query.canal);
    const basis = parseBasis(req.query.basis ?? req.query.base, channel);
    res.json(listExpensesForLens(month, channel, basis));
    return;
  }

  if (month) {
    res.json(
      db
        .prepare(`SELECT * FROM expenses WHERE month = ? ORDER BY due_date, id`)
        .all(month),
    );
    return;
  }
  res.json(db.prepare(`SELECT * FROM expenses ORDER BY month DESC, id DESC`).all());
});

expensesRouter.get("/descriptions", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT description FROM (
         SELECT description FROM expenses
         UNION ALL
         SELECT description FROM expense_rules
       )
       GROUP BY description COLLATE NOCASE
       ORDER BY COUNT(*) DESC, description COLLATE NOCASE
       LIMIT 300`,
    )
    .all() as { description: string }[];
  res.json(rows.map((r) => r.description));
});

expensesRouter.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(Number(req.params.id));
  if (!row) notFound("Despesa");
  res.json(row);
});

expensesRouter.post("/", validateBody(expenseCreateSchema), (req, res) => {
  const row = createExpense(req.body);
  res.status(201).json(row);
});

expensesRouter.patch("/:id", validateBody(expenseUpdateSchema), (req, res) => {
  res.json(updateExpense(Number(req.params.id), req.body));
});

expensesRouter.post("/:id/pay", validateBody(expensePaySchema), (req, res) => {
  res.json(
    payExpense(Number(req.params.id), {
      payment_date: req.body.payment_date,
      reserve_id: req.body.reserve_id,
      account_id: req.body.account_id,
    }),
  );
});

expensesRouter.post("/:id/unpay", (req, res) => {
  res.json(unpayExpense(Number(req.params.id)));
});

expensesRouter.delete("/:id", (req, res) => {
  const scopeRaw = String(req.query.scope ?? "one");
  const scope =
    scopeRaw === "forward" || scopeRaw === "all" || scopeRaw === "one"
      ? scopeRaw
      : "one";
  const result = deleteExpenseScoped(Number(req.params.id), scope);
  res.json(result);
});
