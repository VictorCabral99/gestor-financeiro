import dayjs from "dayjs";
import { addMonths, clampDayInMonth } from "../lib/dates.js";

export type CardCycle = {
  closing_day: number | null;
  due_day: number | null;
};

/**
 * Cartões em que o vencimento cai no mês seguinte ao fechamento
 * (ex.: fecha dia 29, vence dia 5) — a fatura "de agosto" fecha em julho.
 */
export function closesInPreviousMonth(card: CardCycle): boolean {
  return (
    card.closing_day != null &&
    card.due_day != null &&
    card.due_day <= card.closing_day
  );
}

/**
 * Mês de referência da fatura = mês do VENCIMENTO (nome da fatura).
 * Compra após o dia de fechamento do ciclo cai na fatura seguinte.
 */
export function invoiceMonthForCard(card: CardCycle, inclusionDate: string): string {
  const d = dayjs(inclusionDate);
  if (card.closing_day == null) return d.format("YYYY-MM");

  if (closesInPreviousMonth(card)) {
    // Fecha no mês M, vence em M+1 → fatura nomeada por M+1
    // Até o fechamento de M → fatura M+1; depois → fatura M+2
    if (d.date() <= card.closing_day) {
      return d.add(1, "month").format("YYYY-MM");
    }
    return d.add(2, "month").format("YYYY-MM");
  }

  // Fecha e vence no mesmo mês de referência
  if (d.date() > card.closing_day) {
    return d.add(1, "month").format("YYYY-MM");
  }
  return d.format("YYYY-MM");
}

/** Vencimento: sempre no mês de referência da fatura. */
export function invoiceDueDate(card: CardCycle, invoiceMonth: string): string | null {
  if (card.due_day == null) return null;
  return clampDayInMonth(invoiceMonth, card.due_day);
}

/**
 * Fechamento: no mês anterior ao de referência quando vence no mês seguinte
 * ao fechamento (Nubank); caso contrário, no próprio mês da fatura (Unique).
 */
export function invoiceClosingDate(card: CardCycle, invoiceMonth: string): string | null {
  if (card.closing_day == null) return null;
  const closingMonth = closesInPreviousMonth(card)
    ? addMonths(invoiceMonth, -1)
    : invoiceMonth;
  return clampDayInMonth(closingMonth, card.closing_day);
}
