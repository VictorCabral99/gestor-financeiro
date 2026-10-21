import { db } from "../db.js";
import { badRequest, notFound } from "../lib/http.js";
import { assertDateWritable } from "./monthGuard.js";

export type ReserveMovement = {
  id: number;
  reserve_id: number;
  account_id: number;
  direction: "in" | "out";
  amount: number;
  date: string;
  note: string | null;
  reserve_name: string;
  account_name: string;
};

export function listReserveMovements(month?: string): ReserveMovement[] {
  const params: string[] = [];
  let where = "1=1";
  if (month) {
    where += " AND m.date LIKE ?";
    params.push(`${month}-%`);
  }

  return db
    .prepare(
      `SELECT
         m.id, m.reserve_id, m.account_id, m.direction, m.amount, m.date, m.note,
         r.name AS reserve_name,
         a.name AS account_name
       FROM reserve_movements m
       JOIN reserves r ON r.id = m.reserve_id
       JOIN accounts a ON a.id = m.account_id
       WHERE ${where}
       ORDER BY m.date, m.id`,
    )
    .all(...params) as ReserveMovement[];
}

export function createReserveMovement(input: {
  reserve_id: number;
  account_id: number;
  direction: "in" | "out";
  amount: number;
  date: string;
  note?: string | null;
}) {
  if (input.amount <= 0) badRequest("Valor deve ser positivo");
  assertDateWritable(input.date);

  const reserve = db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(input.reserve_id) as
    | { id: number; name: string; current_amount: number; archived: number }
    | undefined;
  if (!reserve || reserve.archived) notFound("Reserva");

  const account = db
    .prepare(`SELECT id, name FROM accounts WHERE id = ? AND archived = 0`)
    .get(input.account_id) as { id: number; name: string } | undefined;
  if (!account) notFound("Conta");

  const nextReserve =
    input.direction === "in"
      ? reserve.current_amount + input.amount
      : reserve.current_amount - input.amount;
  if (nextReserve < 0) badRequest("Saldo insuficiente na reserva");

  const extra = input.note?.trim() ? ` — ${input.note.trim()}` : "";
  const adjAmount = input.direction === "in" ? -input.amount : input.amount;
  const adjNote =
    input.direction === "in"
      ? `Guardar em ${reserve.name}${extra}`
      : `Resgate de ${reserve.name}${extra}`;

  const result = db.transaction(() => {
    const mov = db
      .prepare(
        `INSERT INTO reserve_movements (reserve_id, account_id, direction, amount, date, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.reserve_id,
        input.account_id,
        input.direction,
        input.amount,
        input.date,
        input.note?.trim() || null,
      );
    const moveId = Number(mov.lastInsertRowid);

    db.prepare(`UPDATE reserves SET current_amount = ? WHERE id = ?`).run(
      nextReserve,
      input.reserve_id,
    );

    db.prepare(
      `INSERT INTO account_adjustments (account_id, amount, date, note, reserve_move_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(input.account_id, adjAmount, input.date, adjNote, moveId);

    return moveId;
  })();

  return listReserveMovements().find((m) => m.id === result)!;
}

export function deleteReserveMovement(id: number) {
  const mov = db.prepare(`SELECT * FROM reserve_movements WHERE id = ?`).get(id) as
    | {
        id: number;
        reserve_id: number;
        account_id: number;
        direction: "in" | "out";
        amount: number;
        date: string;
      }
    | undefined;
  if (!mov) notFound("Movimento de reserva");
  assertDateWritable(mov.date);

  const reserve = db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(mov.reserve_id) as
    | { current_amount: number }
    | undefined;
  if (!reserve) notFound("Reserva");

  // Reverte o efeito no saldo da reserva
  const nextReserve =
    mov.direction === "in"
      ? reserve.current_amount - mov.amount
      : reserve.current_amount + mov.amount;
  if (nextReserve < 0) {
    badRequest("Não é possível excluir: a reserva já usou esse valor");
  }

  db.transaction(() => {
    db.prepare(`UPDATE reserves SET current_amount = ? WHERE id = ?`).run(
      nextReserve,
      mov.reserve_id,
    );
    db.prepare(`DELETE FROM account_adjustments WHERE reserve_move_id = ?`).run(id);
    db.prepare(`DELETE FROM reserve_movements WHERE id = ?`).run(id);
  })();
}
