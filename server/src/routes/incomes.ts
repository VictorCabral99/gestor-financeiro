import { Router } from "express";
import { db } from "../db.js";
import { notFound, validateBody } from "../lib/http.js";
import { incomeCreateSchema, incomeUpdateSchema } from "../lib/schemas.js";
import { assertMonthWritable } from "../services/monthGuard.js";

export const incomesRouter = Router();

incomesRouter.get("/", (req, res) => {
  const month = req.query.month as string | undefined;
  if (month) {
    res.json(
      db.prepare(`SELECT * FROM incomes WHERE month = ? ORDER BY id DESC`).all(month),
    );
    return;
  }
  res.json(db.prepare(`SELECT * FROM incomes ORDER BY month DESC, id DESC`).all());
});

incomesRouter.get("/descriptions", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT description FROM incomes
       GROUP BY description COLLATE NOCASE
       ORDER BY COUNT(*) DESC, description COLLATE NOCASE
       LIMIT 300`,
    )
    .all() as { description: string }[];
  res.json(rows.map((r) => r.description));
});

incomesRouter.post("/", validateBody(incomeCreateSchema), (req, res) => {
  const { month, description, amount, account_id, received_date } = req.body;
  assertMonthWritable(month);
  const result = db
    .prepare(
      `INSERT INTO incomes (month, description, amount, account_id, received_date)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(month, description, amount, account_id ?? null, received_date ?? null);
  res.status(201).json(db.prepare(`SELECT * FROM incomes WHERE id = ?`).get(result.lastInsertRowid));
});

incomesRouter.patch("/:id", validateBody(incomeUpdateSchema), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`SELECT * FROM incomes WHERE id = ?`).get(id) as
    | {
        month: string;
        description: string;
        amount: number;
        account_id: number | null;
        received_date: string | null;
      }
    | undefined;
  if (!current) notFound("Receita");

  const nextMonth = req.body.month ?? current.month;
  assertMonthWritable(current.month);
  if (nextMonth !== current.month) assertMonthWritable(nextMonth);

  db.prepare(
    `UPDATE incomes SET month = ?, description = ?, amount = ?, account_id = ?, received_date = ?
     WHERE id = ?`,
  ).run(
    nextMonth,
    req.body.description ?? current.description,
    req.body.amount ?? current.amount,
    req.body.account_id !== undefined ? req.body.account_id : current.account_id,
    req.body.received_date !== undefined ? req.body.received_date : current.received_date,
    id,
  );
  res.json(db.prepare(`SELECT * FROM incomes WHERE id = ?`).get(id));
});

incomesRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`SELECT month FROM incomes WHERE id = ?`).get(id) as
    | { month: string }
    | undefined;
  if (!current) notFound("Receita");
  assertMonthWritable(current.month);
  db.prepare(`DELETE FROM incomes WHERE id = ?`).run(id);
  res.status(204).send();
});
