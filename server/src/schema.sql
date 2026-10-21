-- ==========================================================================
-- Gestor Financeiro - schema SQLite
-- Valores monetários são armazenados em CENTAVOS (INTEGER) para evitar erros
-- de ponto flutuante. Datas em texto ISO (YYYY-MM-DD). Mês em 'YYYY-MM'.
-- ==========================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Contas correntes ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  opening_balance INTEGER NOT NULL DEFAULT 0, -- saldo inicial (centavos)
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Cartões de crédito -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cards (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  credit_limit INTEGER NOT NULL DEFAULT 0, -- limite (centavos)
  closing_day  INTEGER,                    -- dia de fechamento da fatura
  due_day      INTEGER,                    -- dia de vencimento da fatura
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Reservas -----------------------------------------------------------------
-- type: 'investment' (futuro/investimento) | 'future_expense' (separar gasto futuro)
CREATE TABLE IF NOT EXISTS reserves (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  type           TEXT    NOT NULL CHECK (type IN ('investment','future_expense')),
  target_amount  INTEGER NOT NULL DEFAULT 0,  -- meta (centavos)
  current_amount INTEGER NOT NULL DEFAULT 0,  -- valor guardado (centavos)
  account_id     INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  note           TEXT,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Categorias e subcategorias (auto-relacionamento) -------------------------
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  parent_id  INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  color      TEXT    NOT NULL DEFAULT '#64748b',
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Controle de meses --------------------------------------------------------
-- status: 'open' | 'closed'
CREATE TABLE IF NOT EXISTS months (
  month      TEXT PRIMARY KEY,             -- 'YYYY-MM'
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Receitas (salário e outras entradas) -------------------------------------
CREATE TABLE IF NOT EXISTS incomes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  month         TEXT    NOT NULL,           -- 'YYYY-MM'
  description   TEXT    NOT NULL,
  amount        INTEGER NOT NULL,           -- centavos
  account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  received_date TEXT,                       -- data de recebimento
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ajustes pontuais de saldo da conta ---------------------------------------
CREATE TABLE IF NOT EXISTS account_adjustments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,              -- +/- centavos
  date       TEXT    NOT NULL,              -- YYYY-MM-DD
  note       TEXT,
  transfer_id INTEGER,                      -- liga as duas pontas de uma transferência
  reserve_move_id INTEGER,                  -- liga ao movimento conta↔reserva
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Regras de despesas recorrentes ------------------------------------------
-- type: 'fixed_eternal' (fixo sem fim) | 'fixed_installment' (parcelado com fim)
CREATE TABLE IF NOT EXISTS expense_rules (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  description        TEXT    NOT NULL,
  type               TEXT    NOT NULL CHECK (type IN ('fixed_eternal','fixed_installment')),
  amount             INTEGER NOT NULL,        -- valor padrão da parcela (centavos)
  category_id        INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  account_id         INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  card_id            INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  reserve_id         INTEGER REFERENCES reserves(id) ON DELETE SET NULL,
  start_month        TEXT    NOT NULL,        -- 'YYYY-MM' início (corresponde à installment_from)
  installments_total INTEGER,               -- nº total de parcelas (só p/ parcelado)
  installment_from   INTEGER NOT NULL DEFAULT 1, -- parcela correspondente ao start_month (ex.: 4 de 8)
  due_day            INTEGER NOT NULL DEFAULT 10, -- dia de vencimento
  purchase_date      TEXT,                      -- data da compra (parcelado no cartão; compartilhada)
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Faturas de cartão --------------------------------------------------------
-- month: mês de referência da fatura (ciclo)
-- status: 'open' | 'closed' | 'paid'
CREATE TABLE IF NOT EXISTS card_invoices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  month      TEXT    NOT NULL,              -- 'YYYY-MM'
  closing_date TEXT,
  due_date   TEXT,
  status     TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','paid')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (card_id, month)
);

-- Pagamentos de fatura (total ou parcial) debitam a conta ------------------
CREATE TABLE IF NOT EXISTS card_invoice_payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES card_invoices(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount     INTEGER NOT NULL,              -- centavos
  paid_at    TEXT    NOT NULL,              -- YYYY-MM-DD
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Despesas (lançamentos reais de cada mês) --------------------------------
-- kind: 'single' (única/esporádica) | 'fixed_eternal' | 'fixed_installment'
-- status: 'pending' | 'paid'
CREATE TABLE IF NOT EXISTS expenses (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id            INTEGER REFERENCES expense_rules(id) ON DELETE CASCADE,
  description        TEXT    NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('single','fixed_eternal','fixed_installment')),
  amount             INTEGER NOT NULL,       -- centavos (editável por parcela)
  month              TEXT    NOT NULL,       -- 'YYYY-MM'
  category_id        INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  account_id         INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  card_id            INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  reserve_id         INTEGER REFERENCES reserves(id) ON DELETE SET NULL,
  invoice_id         INTEGER REFERENCES card_invoices(id) ON DELETE SET NULL,
  inclusion_date     TEXT    NOT NULL DEFAULT (date('now')), -- data de inclusão
  due_date           TEXT,                   -- data de vencimento
  payment_date       TEXT,                   -- data de pagamento
  status             TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  installment_number INTEGER,                -- nº da parcela atual
  installments_total INTEGER,                -- total de parcelas
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month);
CREATE INDEX IF NOT EXISTS idx_expenses_rule ON expenses(rule_id);
CREATE INDEX IF NOT EXISTS idx_expenses_card ON expenses(card_id);
CREATE INDEX IF NOT EXISTS idx_expenses_invoice ON expenses(invoice_id);
CREATE INDEX IF NOT EXISTS idx_incomes_month ON incomes(month);
CREATE INDEX IF NOT EXISTS idx_adjustments_account ON account_adjustments(account_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON card_invoice_payments(invoice_id);

-- Movimentações conta ↔ reserva (guardar / resgatar) ----------------------
-- direction: 'in' = conta → reserva | 'out' = reserva → conta
CREATE TABLE IF NOT EXISTS reserve_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reserve_id  INTEGER NOT NULL REFERENCES reserves(id) ON DELETE CASCADE,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  direction   TEXT    NOT NULL CHECK (direction IN ('in', 'out')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  date        TEXT    NOT NULL,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reserve_movements_date ON reserve_movements(date);
CREATE INDEX IF NOT EXISTS idx_reserve_movements_reserve ON reserve_movements(reserve_id);

-- Meses pulados de uma regra (exclusão de um único lançamento fixo) --------
CREATE TABLE IF NOT EXISTS expense_rule_skips (
  rule_id INTEGER NOT NULL REFERENCES expense_rules(id) ON DELETE CASCADE,
  month   TEXT    NOT NULL,
  PRIMARY KEY (rule_id, month)
);
