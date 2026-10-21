/** Tabelas que viajam entre o computador e a ponte. Os nomes vêm daqui, nunca do cliente. */

export type SyncFk = {
  column: string;
  parent: string;
  payloadKey: string;
  required: boolean;
};

export type SyncNatural = "month" | "card_month" | "rule_month";

export type SyncTable = {
  name: string;
  /** Como achar a linha dentro do trigger (NEW/OLD). */
  match: "id" | "month" | "rule_month";
  /** Colunas de negócio copiadas no payload, fora as chaves estrangeiras. */
  columns: string[];
  fks: SyncFk[];
  natural?: SyncNatural;
};

export const SYNC_TABLES: SyncTable[] = [
  {
    name: "accounts",
    match: "id",
    columns: ["name", "opening_balance", "archived", "created_at"],
    fks: [],
  },
  {
    name: "cards",
    match: "id",
    columns: ["name", "credit_limit", "closing_day", "due_day", "archived", "created_at"],
    fks: [],
  },
  {
    name: "categories",
    match: "id",
    columns: ["name", "color", "archived", "created_at"],
    fks: [{ column: "parent_id", parent: "categories", payloadKey: "parent_sync_id", required: false }],
  },
  {
    name: "reserves",
    match: "id",
    columns: ["name", "type", "target_amount", "current_amount", "note", "archived", "created_at"],
    fks: [{ column: "account_id", parent: "accounts", payloadKey: "account_sync_id", required: false }],
  },
  {
    name: "months",
    match: "month",
    columns: ["month", "status", "closed_at", "created_at"],
    fks: [],
    natural: "month",
  },
  {
    name: "expense_rules",
    match: "id",
    columns: [
      "description",
      "type",
      "amount",
      "start_month",
      "installments_total",
      "installment_from",
      "due_day",
      "purchase_date",
      "active",
      "created_at",
    ],
    fks: [
      { column: "category_id", parent: "categories", payloadKey: "category_sync_id", required: false },
      { column: "account_id", parent: "accounts", payloadKey: "account_sync_id", required: false },
      { column: "card_id", parent: "cards", payloadKey: "card_sync_id", required: false },
      { column: "reserve_id", parent: "reserves", payloadKey: "reserve_sync_id", required: false },
    ],
  },
  {
    name: "card_invoices",
    match: "id",
    columns: ["month", "closing_date", "due_date", "status", "created_at"],
    fks: [{ column: "card_id", parent: "cards", payloadKey: "card_sync_id", required: true }],
    natural: "card_month",
  },
  {
    name: "incomes",
    match: "id",
    columns: ["month", "description", "amount", "received_date", "created_at"],
    fks: [{ column: "account_id", parent: "accounts", payloadKey: "account_sync_id", required: false }],
  },
  {
    name: "reserve_movements",
    match: "id",
    columns: ["direction", "amount", "date", "note", "created_at"],
    fks: [
      { column: "reserve_id", parent: "reserves", payloadKey: "reserve_sync_id", required: true },
      { column: "account_id", parent: "accounts", payloadKey: "account_sync_id", required: true },
    ],
  },
  {
    name: "account_adjustments",
    match: "id",
    columns: ["amount", "date", "note", "created_at"],
    fks: [
      { column: "account_id", parent: "accounts", payloadKey: "account_sync_id", required: true },
      { column: "transfer_id", parent: "account_adjustments", payloadKey: "transfer_sync_id", required: false },
      { column: "reserve_move_id", parent: "reserve_movements", payloadKey: "reserve_move_sync_id", required: false },
    ],
  },
  {
    name: "expenses",
    match: "id",
    columns: [
      "description",
      "kind",
      "amount",
      "month",
      "inclusion_date",
      "due_date",
      "payment_date",
      "status",
      "installment_number",
      "installments_total",
      "created_at",
    ],
    fks: [
      { column: "rule_id", parent: "expense_rules", payloadKey: "rule_sync_id", required: false },
      { column: "category_id", parent: "categories", payloadKey: "category_sync_id", required: false },
      { column: "account_id", parent: "accounts", payloadKey: "account_sync_id", required: false },
      { column: "card_id", parent: "cards", payloadKey: "card_sync_id", required: false },
      { column: "reserve_id", parent: "reserves", payloadKey: "reserve_sync_id", required: false },
      { column: "invoice_id", parent: "card_invoices", payloadKey: "invoice_sync_id", required: false },
    ],
  },
  {
    name: "card_invoice_payments",
    match: "id",
    columns: ["amount", "paid_at", "note", "created_at"],
    fks: [
      { column: "invoice_id", parent: "card_invoices", payloadKey: "invoice_sync_id", required: true },
      { column: "account_id", parent: "accounts", payloadKey: "account_sync_id", required: true },
    ],
  },
  {
    name: "expense_rule_skips",
    match: "rule_month",
    columns: ["month"],
    fks: [{ column: "rule_id", parent: "expense_rules", payloadKey: "rule_sync_id", required: true }],
    natural: "rule_month",
  },
];

const byName = new Map(SYNC_TABLES.map((table) => [table.name, table]));

export function syncTable(name: string): SyncTable {
  const table = byName.get(name);
  if (!table) throw new Error(`Tabela fora da sincronização: ${name}`);
  return table;
}

export function matchSql(table: SyncTable, row: "NEW" | "OLD"): string {
  if (table.match === "id") return `id = ${row}.id`;
  if (table.match === "month") return `month = ${row}.month`;
  return `rule_id = ${row}.rule_id AND month = ${row}.month`;
}
