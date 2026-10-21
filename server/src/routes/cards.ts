import { Router } from "express";
import { db } from "../db.js";
import { notFound, validateBody } from "../lib/http.js";
import { cardCreateSchema, cardUpdateSchema } from "../lib/schemas.js";
import { cardSummary } from "../services/balances.js";
import {
  ensureInvoiceForMonth,
  getInvoiceDetail,
  listInvoicesByCard,
  refreshAllInvoiceDates,
} from "../services/invoices.js";

export const cardsRouter = Router();

cardsRouter.get("/", (_req, res) => {
  res.json(db.prepare(`SELECT * FROM cards WHERE archived = 0 ORDER BY name`).all());
});

cardsRouter.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(Number(req.params.id));
  if (!row) notFound("Cartão");
  res.json(row);
});

cardsRouter.get("/:id/summary", (req, res) => {
  res.json(cardSummary(Number(req.params.id)));
});

cardsRouter.get("/:id/invoices/:month", (req, res) => {
  const cardId = Number(req.params.id);
  const month = String(req.params.month);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "Mês inválido (use YYYY-MM)" });
    return;
  }
  const card = db.prepare(`SELECT id FROM cards WHERE id = ?`).get(cardId);
  if (!card) notFound("Cartão");

  const ensure = req.query.ensure !== "0";
  const invoiceId = ensure
    ? ensureInvoiceForMonth(cardId, month)
    : ((db
        .prepare(`SELECT id FROM card_invoices WHERE card_id = ? AND month = ?`)
        .get(cardId, month) as { id: number } | undefined)?.id ?? null);

  if (invoiceId == null) {
    res.status(404).json({ error: "Fatura não encontrada" });
    return;
  }

  const detail = getInvoiceDetail(invoiceId);
  if (!detail) notFound("Fatura");
  res.json(detail);
});

cardsRouter.get("/:id/invoices", (req, res) => {
  const card = db.prepare(`SELECT id FROM cards WHERE id = ?`).get(Number(req.params.id));
  if (!card) notFound("Cartão");
  res.json(listInvoicesByCard(Number(req.params.id)));
});

cardsRouter.post("/", validateBody(cardCreateSchema), (req, res) => {
  const { name, credit_limit, closing_day, due_day } = req.body;
  const result = db
    .prepare(
      `INSERT INTO cards (name, credit_limit, closing_day, due_day) VALUES (?, ?, ?, ?)`,
    )
    .run(name, credit_limit ?? 0, closing_day ?? null, due_day ?? null);
  res.status(201).json(db.prepare(`SELECT * FROM cards WHERE id = ?`).get(result.lastInsertRowid));
});

cardsRouter.patch("/:id", validateBody(cardUpdateSchema), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(id) as
    | {
        name: string;
        credit_limit: number;
        closing_day: number | null;
        due_day: number | null;
        archived: number;
      }
    | undefined;
  if (!current) notFound("Cartão");

  db.prepare(
    `UPDATE cards SET name = ?, credit_limit = ?, closing_day = ?, due_day = ?, archived = ? WHERE id = ?`,
  ).run(
    req.body.name ?? current.name,
    req.body.credit_limit ?? current.credit_limit,
    req.body.closing_day !== undefined ? req.body.closing_day : current.closing_day,
    req.body.due_day !== undefined ? req.body.due_day : current.due_day,
    req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : current.archived,
    id,
  );

  if (
    req.body.closing_day !== undefined ||
    req.body.due_day !== undefined
  ) {
    refreshAllInvoiceDates();
  }

  res.json(db.prepare(`SELECT * FROM cards WHERE id = ?`).get(id));
});
