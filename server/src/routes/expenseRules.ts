import { Router } from "express";
import { db } from "../db.js";
import { notFound, validateBody } from "../lib/http.js";
import { expenseRuleCreateSchema, expenseRuleUpdateSchema } from "../lib/schemas.js";
import { syncMonths } from "../services/months.js";

export const expenseRulesRouter = Router();

expenseRulesRouter.get("/", (_req, res) => {
  res.json(
    db.prepare(`SELECT * FROM expense_rules ORDER BY active DESC, description`).all(),
  );
});

expenseRulesRouter.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM expense_rules WHERE id = ?`).get(Number(req.params.id));
  if (!row) notFound("Regra");
  res.json(row);
});

expenseRulesRouter.post("/", validateBody(expenseRuleCreateSchema), (req, res) => {
  const b = req.body;
  const installmentFrom =
    b.type === "fixed_installment" ? (b.installment_from ?? 1) : 1;

  const result = db
    .prepare(
      `INSERT INTO expense_rules (
        description, type, amount, category_id, account_id, card_id, reserve_id,
        start_month, installments_total, installment_from, due_day, purchase_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      b.description,
      b.type,
      b.amount,
      b.category_id ?? null,
      b.card_id ? null : (b.account_id ?? null),
      b.card_id ?? null,
      b.reserve_id ?? null,
      b.start_month,
      b.type === "fixed_installment" ? b.installments_total : null,
      installmentFrom,
      b.due_day ?? 10,
      b.type === "fixed_installment" ? (b.purchase_date ?? null) : null,
    );

  syncMonths();

  res
    .status(201)
    .json(db.prepare(`SELECT * FROM expense_rules WHERE id = ?`).get(result.lastInsertRowid));
});

expenseRulesRouter.patch("/:id", validateBody(expenseRuleUpdateSchema), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`SELECT * FROM expense_rules WHERE id = ?`).get(id) as
    | {
        description: string;
        amount: number;
        category_id: number | null;
        account_id: number | null;
        card_id: number | null;
        reserve_id: number | null;
        due_day: number;
        installments_total: number | null;
        installment_from: number;
        purchase_date: string | null;
        active: number;
      }
    | undefined;
  if (!current) notFound("Regra");

  db.prepare(
    `UPDATE expense_rules SET
      description = ?, amount = ?, category_id = ?, account_id = ?, card_id = ?,
      reserve_id = ?, due_day = ?, installments_total = ?, installment_from = ?,
      purchase_date = ?, active = ?
     WHERE id = ?`,
  ).run(
    req.body.description ?? current.description,
    req.body.amount ?? current.amount,
    req.body.category_id !== undefined ? req.body.category_id : current.category_id,
    req.body.account_id !== undefined ? req.body.account_id : current.account_id,
    req.body.card_id !== undefined ? req.body.card_id : current.card_id,
    req.body.reserve_id !== undefined ? req.body.reserve_id : current.reserve_id,
    req.body.due_day ?? current.due_day,
    req.body.installments_total !== undefined
      ? req.body.installments_total
      : current.installments_total,
    req.body.installment_from ?? current.installment_from ?? 1,
    req.body.purchase_date !== undefined
      ? req.body.purchase_date
      : current.purchase_date,
    req.body.active !== undefined ? (req.body.active ? 1 : 0) : current.active,
    id,
  );

  syncMonths();
  res.json(db.prepare(`SELECT * FROM expense_rules WHERE id = ?`).get(id));
});
