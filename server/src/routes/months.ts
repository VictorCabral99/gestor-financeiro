import { Router } from "express";
import { today } from "../lib/dates.js";
import { notFound, validateBody } from "../lib/http.js";
import { invoicePaySchema } from "../lib/schemas.js";
import {
  closeInvoice,
  getInvoiceDetail,
  listInvoicePayments,
  payInvoice,
  reopenInvoice,
} from "../services/invoices.js";
import { getMonth, listMonths, syncMonths } from "../services/months.js";

export const monthsRouter = Router();

monthsRouter.get("/", (_req, res) => {
  res.json(listMonths());
});

monthsRouter.get("/current", (_req, res) => {
  const sync = syncMonths();
  const month = getMonth(sync.current_month);
  res.json({ ...sync, month });
});

monthsRouter.post("/sync", (_req, res) => {
  res.json(syncMonths());
});

export const invoicesRouter = Router();

invoicesRouter.get("/payments", (req, res) => {
  const month = req.query.month as string | undefined;
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "Mês inválido (use YYYY-MM)" });
    return;
  }
  res.json(listInvoicePayments(month));
});

invoicesRouter.get("/:id", (req, res) => {
  const detail = getInvoiceDetail(Number(req.params.id));
  if (!detail) notFound("Fatura");
  res.json(detail);
});

invoicesRouter.post("/:id/close", (req, res) => {
  res.json(closeInvoice(Number(req.params.id)));
});

invoicesRouter.post("/:id/reopen", (req, res) => {
  res.json(reopenInvoice(Number(req.params.id)));
});

invoicesRouter.post("/:id/pay", validateBody(invoicePaySchema), (req, res) => {
  res.json(
    payInvoice({
      invoiceId: Number(req.params.id),
      accountId: req.body.account_id,
      amount: req.body.amount,
      paidAt: req.body.paid_at ?? today(),
      note: req.body.note,
    }),
  );
});
