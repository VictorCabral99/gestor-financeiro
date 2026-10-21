import { z } from "zod";

export const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido (YYYY-MM)");
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)");

export const accountCreateSchema = z.object({
  name: z.string().min(1),
  opening_balance: z.number().int().default(0),
});

export const accountUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  opening_balance: z.number().int().optional(),
  archived: z.boolean().optional(),
});

/** Define o saldo desejado; o sistema cria o ajuste da diferença. */
export const accountSetBalanceSchema = z.object({
  balance: z.number().int(),
  date: dateSchema,
  note: z.string().nullable().optional(),
});

export const cardCreateSchema = z.object({
  name: z.string().min(1),
  credit_limit: z.number().int().nonnegative().default(0),
  closing_day: z.number().int().min(1).max(31).nullable().optional(),
  due_day: z.number().int().min(1).max(31).nullable().optional(),
});

export const cardUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  credit_limit: z.number().int().nonnegative().optional(),
  closing_day: z.number().int().min(1).max(31).nullable().optional(),
  due_day: z.number().int().min(1).max(31).nullable().optional(),
  archived: z.boolean().optional(),
});

export const reserveCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["investment", "future_expense"]),
  target_amount: z.number().int().nonnegative().default(0),
  current_amount: z.number().int().nonnegative().default(0),
  account_id: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const reserveUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["investment", "future_expense"]).optional(),
  target_amount: z.number().int().nonnegative().optional(),
  account_id: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

export const reserveMoveSchema = z.object({
  direction: z.enum(["in", "out"]),
  amount: z.number().int().positive(),
  account_id: z.number().int().positive().optional(),
  date: dateSchema,
  note: z.string().nullable().optional(),
});

export const categoryCreateSchema = z.object({
  name: z.string().min(1),
  parent_id: z.number().int().positive().nullable().optional(),
  color: z.string().min(1).optional(),
});

export const categoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  parent_id: z.number().int().positive().nullable().optional(),
  color: z.string().min(1).optional(),
  archived: z.boolean().optional(),
});

export const incomeCreateSchema = z.object({
  month: monthSchema,
  description: z.string().min(1),
  amount: z.number().int().positive(),
  account_id: z.number().int().positive().nullable().optional(),
  received_date: dateSchema.nullable().optional(),
});

export const incomeUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
  account_id: z.number().int().positive().nullable().optional(),
  received_date: dateSchema.nullable().optional(),
  month: monthSchema.optional(),
});

export const adjustmentCreateSchema = z.object({
  account_id: z.number().int().positive(),
  amount: z.number().int(), // pode ser negativo
  date: dateSchema,
  note: z.string().nullable().optional(),
});

export const transferCreateSchema = z
  .object({
    from_account_id: z.number().int().positive(),
    to_account_id: z.number().int().positive(),
    amount: z.number().int().positive(),
    date: dateSchema,
    note: z.string().nullable().optional(),
  })
  .refine((d) => d.from_account_id !== d.to_account_id, {
    message: "Conta de origem e destino devem ser diferentes",
  });

export const expenseRuleCreateSchema = z
  .object({
    description: z.string().min(1),
    type: z.enum(["fixed_eternal", "fixed_installment"]),
    amount: z.number().int().positive(),
    category_id: z.number().int().positive().nullable().optional(),
    account_id: z.number().int().positive().nullable().optional(),
    card_id: z.number().int().positive().nullable().optional(),
    reserve_id: z.number().int().positive().nullable().optional(),
    start_month: monthSchema,
    installments_total: z.number().int().positive().nullable().optional(),
    /** Parcela correspondente ao start_month (ex.: já paguei 3, atual = 4) */
    installment_from: z.number().int().positive().default(1),
    due_day: z.number().int().min(1).max(31).default(10),
    /** Data real da compra (parcelado no cartão); mesma em todas as parcelas. */
    purchase_date: dateSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "fixed_installment") {
      if (!data.installments_total) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Parcelado exige installments_total",
          path: ["installments_total"],
        });
      } else if (data.installment_from > data.installments_total) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Parcela atual não pode ser maior que o total",
          path: ["installment_from"],
        });
      }
    }
  });

export const expenseRuleUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
  category_id: z.number().int().positive().nullable().optional(),
  account_id: z.number().int().positive().nullable().optional(),
  card_id: z.number().int().positive().nullable().optional(),
  reserve_id: z.number().int().positive().nullable().optional(),
  due_day: z.number().int().min(1).max(31).optional(),
  installments_total: z.number().int().positive().nullable().optional(),
  installment_from: z.number().int().positive().optional(),
  purchase_date: dateSchema.nullable().optional(),
  active: z.boolean().optional(),
});

export const expenseCreateSchema = z.object({
  description: z.string().min(1),
  amount: z.number().int().positive(),
  month: monthSchema,
  category_id: z.number().int().positive().nullable().optional(),
  account_id: z.number().int().positive().nullable().optional(),
  card_id: z.number().int().positive().nullable().optional(),
  reserve_id: z.number().int().positive().nullable().optional(),
  inclusion_date: dateSchema.optional(),
  due_date: dateSchema.nullable().optional(),
  payment_date: dateSchema.nullable().optional(),
  status: z.enum(["pending", "paid"]).optional(),
  /** Quando informado, a compra entra nesta fatura (não recalcula pelo ciclo da data). */
  invoice_id: z.number().int().positive().nullable().optional(),
});

export const expenseUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
  category_id: z.number().int().positive().nullable().optional(),
  account_id: z.number().int().positive().nullable().optional(),
  card_id: z.number().int().positive().nullable().optional(),
  reserve_id: z.number().int().positive().nullable().optional(),
  inclusion_date: dateSchema.optional(),
  due_date: dateSchema.nullable().optional(),
  payment_date: dateSchema.nullable().optional(),
  status: z.enum(["pending", "paid"]).optional(),
  amount_scope: z.enum(["one", "forward"]).optional(),
  invoice_id: z.number().int().positive().nullable().optional(),
});

export const expensePaySchema = z.object({
  payment_date: dateSchema.optional(),
  reserve_id: z.number().int().positive().nullable().optional(),
  /** Conta de onde o pagamento sai (pode diferir da conta padrão do lançamento). */
  account_id: z.number().int().positive().nullable().optional(),
});

export const invoicePaySchema = z.object({
  account_id: z.number().int().positive(),
  amount: z.number().int().positive(),
  paid_at: dateSchema.optional(),
  note: z.string().nullable().optional(),
});
