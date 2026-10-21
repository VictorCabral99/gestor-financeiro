export type Account = {
  id: number;
  name: string;
  opening_balance: number;
  archived: number;
};

export type AccountBalance = {
  account_id: number;
  name: string;
  opening_balance: number;
  incomes: number;
  expenses_paid: number;
  invoice_payments: number;
  adjustments: number;
  balance: number;
  reserved: number;
  available: number;
};

export type Card = {
  id: number;
  name: string;
  credit_limit: number;
  closing_day: number | null;
  due_day: number | null;
  archived: number;
};

export type CardSummary = {
  card_id: number;
  name: string;
  credit_limit: number;
  used: number;
  available: number;
};

export type Reserve = {
  id: number;
  name: string;
  type: "investment" | "future_expense";
  target_amount: number;
  current_amount: number;
  account_id: number | null;
  note: string | null;
  archived: number;
};

export type Category = {
  id: number;
  name: string;
  parent_id: number | null;
  color: string;
  archived: number;
};

export type Income = {
  id: number;
  month: string;
  description: string;
  amount: number;
  account_id: number | null;
  received_date: string | null;
};

export type Expense = {
  id: number;
  rule_id: number | null;
  description: string;
  kind: "single" | "fixed_eternal" | "fixed_installment";
  amount: number;
  month: string;
  category_id: number | null;
  account_id: number | null;
  card_id: number | null;
  reserve_id: number | null;
  invoice_id: number | null;
  inclusion_date: string;
  due_date: string | null;
  payment_date: string | null;
  status: "pending" | "paid";
  installment_number: number | null;
  installments_total: number | null;
};

/** Movimento conta ↔ reserva. */
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

/** Transferência entre contas (aparece nas movimentações). */
export type AccountTransfer = {
  transfer_id: number;
  date: string;
  amount: number;
  from_account_id: number;
  to_account_id: number;
  from_name: string;
  to_name: string;
  note: string | null;
};

/** Pagamento de fatura de cartão (debita a conta). */
export type InvoicePayment = {
  id: number;
  invoice_id: number;
  account_id: number;
  amount: number;
  paid_at: string;
  note: string | null;
  account_name: string;
  card_name: string;
  invoice_month: string;
  invoice_due_date: string | null;
};

export type ExpenseRule = {
  id: number;
  description: string;
  type: "fixed_eternal" | "fixed_installment";
  amount: number;
  category_id: number | null;
  account_id: number | null;
  card_id: number | null;
  reserve_id: number | null;
  start_month: string;
  installments_total: number | null;
  installment_from?: number;
  due_day: number;
  purchase_date?: string | null;
  active: number;
};

export type Dashboard = {
  month: string;
  channel?: "contas" | "cartoes" | "tudo";
  basis?: "compra" | "caixa" | "fatura";
  totals: {
    incomes: number;
    expenses: number;
    expenses_paid: number;
    expenses_pending: number;
    balance_month: number;
    spent?: number;
    spent_accounts?: number;
    spent_cards?: number;
    cash_out?: number;
    pending?: number;
    paid?: number;
    balance?: number;
  };
  after_obligations?: {
    cash: number;
    pending_accounts: number;
    unpaid_invoices: number;
    available: number;
  };
  accounts: AccountBalance[];
  cards: CardSummary[];
  reserves: Reserve[];
};

export type CardInvoice = {
  id: number;
  card_id: number;
  month: string;
  closing_date: string | null;
  due_date: string | null;
  status: "open" | "closed" | "paid" | string;
  total_expenses?: number;
  total_paid?: number;
  remaining?: number;
};

/** Detalhe da fatura com compras e pagamentos. */
export type InvoiceDetail = CardInvoice & {
  total_expenses: number;
  total_paid: number;
  remaining: number;
  expenses: Expense[];
  payments: InvoicePayment[];
};
