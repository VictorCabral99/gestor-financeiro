import { Router } from "express";
import { db } from "../db.js";
import { notFound, validateBody } from "../lib/http.js";
import {
  accountCreateSchema,
  accountSetBalanceSchema,
  accountUpdateSchema,
} from "../lib/schemas.js";
import { accountBalance } from "../services/balances.js";
import { assertDateWritable } from "../services/monthGuard.js";

export const accountsRouter = Router();

accountsRouter.get("/", (_req, res) => {
  const rows = db
    .prepare(`SELECT * FROM accounts WHERE archived = 0 ORDER BY name`)
    .all();
  res.json(rows);
});

accountsRouter.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(Number(req.params.id));
  if (!row) notFound("Conta");
  res.json(row);
});

accountsRouter.get("/:id/balance", (req, res) => {
  res.json(accountBalance(Number(req.params.id)));
});

accountsRouter.post(
  "/:id/set-balance",
  validateBody(accountSetBalanceSchema),
  (req, res) => {
    const id = Number(req.params.id);
    const account = db.prepare(`SELECT id, name FROM accounts WHERE id = ?`).get(id) as
      | { id: number; name: string }
      | undefined;
    if (!account) notFound("Conta");

    const before = accountBalance(id);
    const target = req.body.balance as number;
    const delta = target - before.balance;

    if (delta === 0) {
      res.json({
        adjustment: null,
        before: before.balance,
        after: before.balance,
        delta: 0,
        message: "Saldo já confere com o valor informado",
      });
      return;
    }

    assertDateWritable(req.body.date);

    const noteBase = `Ajuste para saldo ${(target / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    })}`;
    const extra = req.body.note?.trim() ? ` — ${req.body.note.trim()}` : "";
    const result = db
      .prepare(
        `INSERT INTO account_adjustments (account_id, amount, date, note)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, delta, req.body.date, `${noteBase}${extra}`);

    const after = accountBalance(id);
    const adjustment = db
      .prepare(`SELECT * FROM account_adjustments WHERE id = ?`)
      .get(result.lastInsertRowid);

    res.status(201).json({
      adjustment,
      before: before.balance,
      after: after.balance,
      delta,
    });
  },
);

accountsRouter.post("/", validateBody(accountCreateSchema), (req, res) => {
  const { name, opening_balance } = req.body;
  const result = db
    .prepare(`INSERT INTO accounts (name, opening_balance) VALUES (?, ?)`)
    .run(name, opening_balance ?? 0);
  const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json(row);
});

accountsRouter.patch("/:id", validateBody(accountUpdateSchema), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as
    | { name: string; opening_balance: number; archived: number }
    | undefined;
  if (!current) notFound("Conta");

  db.prepare(
    `UPDATE accounts SET name = ?, opening_balance = ?, archived = ? WHERE id = ?`,
  ).run(
    req.body.name ?? current.name,
    req.body.opening_balance ?? current.opening_balance,
    req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : current.archived,
    id,
  );
  res.json(db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id));
});
