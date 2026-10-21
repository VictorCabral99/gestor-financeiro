import { Router } from "express";
import { db } from "../db.js";
import { badRequest, notFound, validateBody } from "../lib/http.js";
import { transferCreateSchema } from "../lib/schemas.js";
import { assertDateWritable } from "../services/monthGuard.js";

export const transfersRouter = Router();

type TransferRow = {
  transfer_id: number;
  date: string;
  amount: number;
  from_account_id: number;
  to_account_id: number;
  from_name: string;
  to_name: string;
  note: string | null;
};

function listTransfers(month?: string): TransferRow[] {
  const params: string[] = [];
  let where = `d.transfer_id IS NOT NULL AND d.amount < 0 AND c.amount > 0`;
  if (month) {
    where += ` AND d.date LIKE ?`;
    params.push(`${month}-%`);
  }

  const rows = db
    .prepare(
      `SELECT
         d.transfer_id AS transfer_id,
         d.date AS date,
         c.amount AS amount,
         d.account_id AS from_account_id,
         c.account_id AS to_account_id,
         fa.name AS from_name,
         ta.name AS to_name,
         d.note AS debit_note
       FROM account_adjustments d
       JOIN account_adjustments c
         ON c.transfer_id = d.transfer_id AND c.id != d.id AND c.amount > 0
       JOIN accounts fa ON fa.id = d.account_id
       JOIN accounts ta ON ta.id = c.account_id
       WHERE ${where}
       ORDER BY d.date, d.transfer_id`,
    )
    .all(...params) as {
    transfer_id: number;
    date: string;
    amount: number;
    from_account_id: number;
    to_account_id: number;
    from_name: string;
    to_name: string;
    debit_note: string | null;
  }[];

  return rows.map((r) => {
    const marker = " — ";
    const idx = r.debit_note?.indexOf(marker) ?? -1;
    const note =
      idx >= 0 ? (r.debit_note!.slice(idx + marker.length).trim() || null) : null;
    return {
      transfer_id: r.transfer_id,
      date: r.date,
      amount: r.amount,
      from_account_id: r.from_account_id,
      to_account_id: r.to_account_id,
      from_name: r.from_name,
      to_name: r.to_name,
      note,
    };
  });
}

transfersRouter.get("/", (req, res) => {
  const month = req.query.month as string | undefined;
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    badRequest("Mês inválido (use YYYY-MM)");
  }
  res.json(listTransfers(month));
});

transfersRouter.post("/", validateBody(transferCreateSchema), (req, res) => {
  const { from_account_id, to_account_id, amount, date, note } = req.body;
  assertDateWritable(date);

  const from = db
    .prepare(`SELECT id, name FROM accounts WHERE id = ? AND archived = 0`)
    .get(from_account_id) as { id: number; name: string } | undefined;
  const to = db
    .prepare(`SELECT id, name FROM accounts WHERE id = ? AND archived = 0`)
    .get(to_account_id) as { id: number; name: string } | undefined;

  if (!from) notFound("Conta de origem");
  if (!to) notFound("Conta de destino");
  if (amount <= 0) badRequest("Valor da transferência deve ser positivo");

  const extra = note?.trim() ? ` — ${note.trim()}` : "";
  const outNote = `Transferência para ${to.name}${extra}`;
  const inNote = `Transferência de ${from.name}${extra}`;

  const insert = db.prepare(
    `INSERT INTO account_adjustments (account_id, amount, date, note, transfer_id)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const result = db.transaction(() => {
    const debit = insert.run(from_account_id, -amount, date, outNote, null);
    const transferId = Number(debit.lastInsertRowid);
    db.prepare(`UPDATE account_adjustments SET transfer_id = ? WHERE id = ?`).run(
      transferId,
      transferId,
    );
    const credit = insert.run(to_account_id, amount, date, inNote, transferId);
    return {
      transfer_id: transferId,
      amount,
      date,
      from_account_id,
      to_account_id,
      from_name: from.name,
      to_name: to.name,
      note: note?.trim() || null,
      debit_id: transferId,
      credit_id: Number(credit.lastInsertRowid),
    };
  })();

  res.status(201).json(result);
});

transfersRouter.delete("/:id", (req, res) => {
  const transferId = Number(req.params.id);
  const existing = db
    .prepare(`SELECT id, date FROM account_adjustments WHERE transfer_id = ? LIMIT 1`)
    .get(transferId) as { id: number; date: string } | undefined;
  if (!existing) notFound("Transferência");
  assertDateWritable(existing.date);

  db.prepare(`DELETE FROM account_adjustments WHERE transfer_id = ?`).run(transferId);
  res.status(204).send();
});
