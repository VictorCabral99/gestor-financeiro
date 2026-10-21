import { db } from "../db.js";
import { currentMonth, isValidDate, isValidMonth, type MonthKey } from "../lib/dates.js";
import { badRequest } from "../lib/http.js";

export function monthFromDate(date: string): MonthKey {
  return date.slice(0, 7);
}

/** Bloqueia mutações em meses fechados (passados). */
export function assertMonthWritable(month: string): void {
  if (!isValidMonth(month)) badRequest("Mês inválido (use YYYY-MM)");

  const row = db
    .prepare(`SELECT status FROM months WHERE month = ?`)
    .get(month) as { status: string } | undefined;

  const status = row?.status ?? (month < currentMonth() ? "closed" : "open");
  if (status === "closed") {
    badRequest(`Mês ${month} está fechado e não pode ser alterado`);
  }
}

export function assertDateWritable(date: string): void {
  if (!isValidDate(date)) badRequest("Data inválida");
  assertMonthWritable(monthFromDate(date));
}

export function isMonthWritable(month: string): boolean {
  try {
    assertMonthWritable(month);
    return true;
  } catch {
    return false;
  }
}
