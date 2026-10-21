import { Router } from "express";
import { db } from "../db.js";
import { badRequest, notFound, validateBody } from "../lib/http.js";
import {
  reserveCreateSchema,
  reserveMoveSchema,
  reserveUpdateSchema,
} from "../lib/schemas.js";
import { today } from "../lib/dates.js";
import {
  createReserveMovement,
  deleteReserveMovement,
  listReserveMovements,
} from "../services/reserveMovements.js";

export const reservesRouter = Router();

reservesRouter.get("/movements", (req, res) => {
  const month = req.query.month as string | undefined;
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    badRequest("Mês inválido (use YYYY-MM)");
  }
  res.json(listReserveMovements(month));
});

reservesRouter.delete("/movements/:id", (req, res) => {
  deleteReserveMovement(Number(req.params.id));
  res.status(204).send();
});

reservesRouter.get("/", (_req, res) => {
  res.json(db.prepare(`SELECT * FROM reserves WHERE archived = 0 ORDER BY name`).all());
});

reservesRouter.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(Number(req.params.id));
  if (!row) notFound("Reserva");
  res.json(row);
});

reservesRouter.post("/", validateBody(reserveCreateSchema), (req, res) => {
  const { name, type, target_amount, current_amount, account_id, note } = req.body;
  const initial = current_amount ?? 0;

  if (initial > 0 && !account_id) {
    badRequest("Informe a conta para guardar o saldo inicial da reserva");
  }

  const created = db
    .prepare(
      `INSERT INTO reserves (name, type, target_amount, current_amount, account_id, note)
       VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .run(name, type, target_amount ?? 0, account_id ?? null, note ?? null);
  const id = Number(created.lastInsertRowid);

  if (initial > 0 && account_id) {
    createReserveMovement({
      reserve_id: id,
      account_id,
      direction: "in",
      amount: initial,
      date: today(),
      note: "Saldo inicial",
    });
  }

  res.status(201).json(db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(id));
});

reservesRouter.patch("/:id", validateBody(reserveUpdateSchema), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(id) as
    | {
        name: string;
        type: string;
        target_amount: number;
        account_id: number | null;
        note: string | null;
        archived: number;
      }
    | undefined;
  if (!current) notFound("Reserva");

  db.prepare(
    `UPDATE reserves SET name = ?, type = ?, target_amount = ?, account_id = ?, note = ?, archived = ?
     WHERE id = ?`,
  ).run(
    req.body.name ?? current.name,
    req.body.type ?? current.type,
    req.body.target_amount ?? current.target_amount,
    req.body.account_id !== undefined ? req.body.account_id : current.account_id,
    req.body.note !== undefined ? req.body.note : current.note,
    req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : current.archived,
    id,
  );
  res.json(db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(id));
});

/** Exclui reserva sem saldo. Histórico de ajustes na conta permanece. */
reservesRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(id) as
    | { id: number; current_amount: number; name: string }
    | undefined;
  if (!current) notFound("Reserva");
  if (current.current_amount !== 0) {
    badRequest("Resgate o saldo da reserva antes de excluir");
  }

  // Movimentos caem em CASCADE; ajustes da conta (reserve_move_id) ficam no histórico.
  db.prepare(`DELETE FROM reserves WHERE id = ?`).run(id);
  res.status(204).send();
});

/** Guardar (in) ou resgatar (out) entre conta e reserva. */
reservesRouter.post("/:id/move", validateBody(reserveMoveSchema), (req, res) => {
  const id = Number(req.params.id);
  const reserve = db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(id) as
    | { id: number; account_id: number | null; archived: number }
    | undefined;
  if (!reserve || reserve.archived) notFound("Reserva");

  const accountId = req.body.account_id ?? reserve.account_id;
  if (!accountId) badRequest("Informe a conta corrente");

  const movement = createReserveMovement({
    reserve_id: id,
    account_id: accountId,
    direction: req.body.direction,
    amount: req.body.amount,
    date: req.body.date,
    note: req.body.note,
  });

  res.status(201).json({
    movement,
    reserve: db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(id),
  });
});
