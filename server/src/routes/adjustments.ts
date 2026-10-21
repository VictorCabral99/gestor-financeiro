import { Router } from "express";
import { db } from "../db.js";
import { notFound, validateBody } from "../lib/http.js";
import { adjustmentCreateSchema } from "../lib/schemas.js";
import { assertDateWritable } from "../services/monthGuard.js";

export const adjustmentsRouter = Router();

adjustmentsRouter.get("/", (req, res) => {
  const accountId = req.query.account_id ? Number(req.query.account_id) : null;
  if (accountId) {
    res.json(
      db
        .prepare(
          `SELECT * FROM account_adjustments WHERE account_id = ? ORDER BY date DESC, id DESC`,
        )
        .all(accountId),
    );
    return;
  }
  res.json(
    db.prepare(`SELECT * FROM account_adjustments ORDER BY date DESC, id DESC`).all(),
  );
});

adjustmentsRouter.post("/", validateBody(adjustmentCreateSchema), (req, res) => {
  const { account_id, amount, date, note } = req.body;
  assertDateWritable(date);
  const account = db.prepare(`SELECT id FROM accounts WHERE id = ?`).get(account_id);
  if (!account) notFound("Conta");

  const result = db
    .prepare(
      `INSERT INTO account_adjustments (account_id, amount, date, note) VALUES (?, ?, ?, ?)`,
    )
    .run(account_id, amount, date, note ?? null);
  res
    .status(201)
    .json(
      db.prepare(`SELECT * FROM account_adjustments WHERE id = ?`).get(result.lastInsertRowid),
    );
});

adjustmentsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db
    .prepare(`SELECT date FROM account_adjustments WHERE id = ?`)
    .get(id) as { date: string } | undefined;
  if (!current) notFound("Ajuste");
  assertDateWritable(current.date);
  db.prepare(`DELETE FROM account_adjustments WHERE id = ?`).run(id);
  res.status(204).send();
});
