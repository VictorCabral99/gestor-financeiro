import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  closesInPreviousMonth,
  invoiceClosingDate,
  invoiceDueDate,
  invoiceMonthForCard,
} from "./invoiceCycle.js";

const nubank = { closing_day: 29, due_day: 5 };
const unique = { closing_day: 11, due_day: 18 };

describe("invoiceCycle", () => {
  it("detecta ciclo Nubank (vence no mês seguinte)", () => {
    assert.equal(closesInPreviousMonth(nubank), true);
    assert.equal(closesInPreviousMonth(unique), false);
  });

  it("Nubank: compra até o fechamento cai na fatura do mês seguinte", () => {
    // Fecha 29/07 → fatura de agosto (vence 05/08)
    assert.equal(invoiceMonthForCard(nubank, "2026-07-29"), "2026-08");
    assert.equal(invoiceMonthForCard(nubank, "2026-07-30"), "2026-09");
  });

  it("Unique: compra após fechamento cai na fatura seguinte", () => {
    assert.equal(invoiceMonthForCard(unique, "2026-08-11"), "2026-08");
    assert.equal(invoiceMonthForCard(unique, "2026-08-12"), "2026-09");
  });

  it("calcula datas de fechamento e vencimento", () => {
    assert.equal(invoiceDueDate(nubank, "2026-08"), "2026-08-05");
    assert.equal(invoiceClosingDate(nubank, "2026-08"), "2026-07-29");

    assert.equal(invoiceDueDate(unique, "2026-08"), "2026-08-18");
    assert.equal(invoiceClosingDate(unique, "2026-08"), "2026-08-11");
  });

  it("clamp de dia 31 no fechamento de fevereiro", () => {
    const card = { closing_day: 31, due_day: 10 };
    assert.equal(invoiceClosingDate(card, "2026-03"), "2026-02-28");
    assert.equal(invoiceDueDate(card, "2026-03"), "2026-03-10");
  });
});
