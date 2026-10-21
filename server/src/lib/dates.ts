import dayjs from "dayjs";

export type MonthKey = string; // YYYY-MM

export function today(): string {
  return dayjs().format("YYYY-MM-DD");
}

export function currentMonth(): MonthKey {
  return dayjs().format("YYYY-MM");
}

export function parseMonth(month: MonthKey): dayjs.Dayjs {
  return dayjs(`${month}-01`);
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  return parseMonth(month).add(n, "month").format("YYYY-MM");
}

export function monthsBetween(start: MonthKey, end: MonthKey): number {
  return parseMonth(end).diff(parseMonth(start), "month");
}

export function clampDayInMonth(month: MonthKey, day: number): string {
  const base = parseMonth(month);
  const last = base.daysInMonth();
  const d = Math.min(Math.max(1, day), last);
  return base.date(d).format("YYYY-MM-DD");
}

export function isValidMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const d = dayjs(`${value}-01`);
  return d.isValid() && d.format("YYYY-MM") === value;
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = dayjs(value);
  return d.isValid() && d.format("YYYY-MM-DD") === value;
}
