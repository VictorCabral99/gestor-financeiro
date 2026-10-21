import { Link } from "react-router-dom";
import { money, formatDateBr } from "../lib/format";
import { categoryName, isOverdue } from "../lib/expenseHelpers";
import type {
  Account,
  AccountTransfer,
  Card,
  Category,
  Expense,
  InvoicePayment,
  Reserve,
  ReserveMovement,
} from "../types";

export type MovementDetail =
  | { type: "expense"; expense: Expense }
  | { type: "transfer"; transfer: AccountTransfer }
  | { type: "reserve"; reserveMove: ReserveMovement }
  | { type: "invoice-pay"; payment: InvoicePayment };

type Props = {
  detail: MovementDetail;
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  reserves: Reserve[];
  onClose: () => void;
  onPay?: (expense: Expense) => void;
  onEdit?: (expense: Expense) => void;
  onDeleteExpense?: (expense: Expense) => void;
  onDeleteTransfer?: (transfer: AccountTransfer) => void;
  onDeleteReserveMove?: (move: ReserveMovement) => void;
};

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

export function MovementDetailModal({
  detail,
  accounts,
  cards,
  categories,
  reserves,
  onClose,
  onPay,
  onEdit,
  onDeleteExpense,
  onDeleteTransfer,
  onDeleteReserveMove,
}: Props) {
  let title = "Detalhes";
  let amount = 0;
  let badge: { className: string; label: string } | null = null;
  const rows: { label: string; value: string | null }[] = [];

  if (detail.type === "expense") {
    const e = detail.expense;
    title = e.description;
    amount = e.amount;
    if (e.card_id) {
      badge =
        e.status === "paid"
          ? { className: "badge badge-paid", label: "Fatura paga" }
          : { className: "badge badge-card", label: "No cartão" };
    } else {
      badge = isOverdue(e)
        ? { className: "badge badge-overdue", label: "Atrasado" }
        : e.status === "paid"
          ? { className: "badge badge-paid", label: "Pago" }
          : { className: "badge badge-pending", label: "Pendente" };
    }

    rows.push(
      {
        label: "Tipo",
        value: e.card_id
          ? e.kind === "fixed_installment"
            ? "Parcelado no cartão"
            : e.kind === "fixed_eternal"
              ? "Fixo no cartão"
              : "Compra no cartão"
          : e.kind === "single"
            ? "Única / esporádica"
            : e.kind === "fixed_eternal"
              ? "Fixo eterno"
              : "Parcelado",
      },
      {
        label: "Parcela",
        value:
          e.installment_number != null && e.installments_total != null
            ? `${e.installment_number} de ${e.installments_total}`
            : null,
      },
      { label: "Mês", value: e.month },
      {
        label: "Categoria",
        value: categoryName(categories, e.category_id),
      },
      {
        label: "Conta",
        value: e.account_id
          ? (accounts.find((a) => a.id === e.account_id)?.name ?? null)
          : null,
      },
      {
        label: "Cartão",
        value: e.card_id
          ? (cards.find((c) => c.id === e.card_id)?.name ?? null)
          : null,
      },
      {
        label: "Reserva",
        value: e.reserve_id
          ? (reserves.find((r) => r.id === e.reserve_id)?.name ?? null)
          : null,
      },
      {
        label: e.card_id ? "Data da compra" : "Inclusão",
        value: e.inclusion_date ? formatDateBr(e.inclusion_date) : null,
      },
      {
        label: e.card_id ? "Vencimento (fatura)" : "Vencimento",
        value: e.due_date ? formatDateBr(e.due_date) : null,
      },
      {
        label: "Pagamento",
        value: e.payment_date ? formatDateBr(e.payment_date) : null,
      },
      {
        label: "Obs.",
        value: e.card_id
          ? e.status === "paid"
            ? "Conta debitada no pagamento da fatura."
            : "Não debita a conta até pagar a fatura."
          : null,
      },
    );
  } else if (detail.type === "transfer") {
    const t = detail.transfer;
    title = `${t.from_name} → ${t.to_name}`;
    amount = t.amount;
    badge = { className: "badge badge-transfer", label: "Transferência" };
    rows.push(
      { label: "De", value: t.from_name },
      { label: "Para", value: t.to_name },
      { label: "Data", value: formatDateBr(t.date) },
      { label: "Nota", value: t.note },
    );
  } else if (detail.type === "reserve") {
    const r = detail.reserveMove;
    title =
      r.direction === "in"
        ? `${r.account_name} → ${r.reserve_name}`
        : `${r.reserve_name} → ${r.account_name}`;
    amount = r.amount;
    badge =
      r.direction === "in"
        ? { className: "badge badge-reserve-in", label: "Guardar" }
        : { className: "badge badge-reserve-out", label: "Resgate" };
    rows.push(
      {
        label: "Movimento",
        value:
          r.direction === "in"
            ? "Guardar na reserva (conta → reserva)"
            : "Resgate da reserva (reserva → conta)",
      },
      { label: "Conta", value: r.account_name },
      { label: "Reserva", value: r.reserve_name },
      { label: "Data", value: formatDateBr(r.date) },
      { label: "Nota", value: r.note },
    );
  } else {
    const p = detail.payment;
    title = `Pagamento fatura ${p.card_name}`;
    amount = p.amount;
    badge = { className: "badge badge-invoice-pay", label: "Fatura" };
    rows.push(
      { label: "Cartão", value: p.card_name },
      { label: "Fatura", value: p.invoice_month },
      {
        label: "Venc. fatura",
        value: p.invoice_due_date ? formatDateBr(p.invoice_due_date) : null,
      },
      { label: "Debitado de", value: p.account_name },
      { label: "Data", value: formatDateBr(p.paid_at) },
      { label: "Nota", value: p.note },
    );
  }

  const canPayAccountExpense =
    detail.type === "expense" &&
    detail.expense.status === "pending" &&
    !detail.expense.card_id &&
    onPay;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="detail-head">
          <div className="money-lg">{money(amount)}</div>
          {badge && <span className={badge.className}>{badge.label}</span>}
        </div>
        <div className="detail-list">
          {rows.map((r) => (
            <DetailRow key={r.label} label={r.label} value={r.value} />
          ))}
        </div>
        <div className="form-actions" style={{ marginTop: "1rem" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
          {canPayAccountExpense && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onPay(detail.expense)}
            >
              Pagar
            </button>
          )}
          {detail.type === "expense" && detail.expense.card_id && (
            <Link
              className="btn btn-primary"
              to={
                detail.expense.invoice_id
                  ? `/faturas?invoice=${detail.expense.invoice_id}&card=${detail.expense.card_id}`
                  : `/faturas?card=${detail.expense.card_id}`
              }
              onClick={onClose}
            >
              Ver fatura
            </Link>
          )}
          {detail.type === "expense" && onEdit && (
            <button
              type="button"
              className="btn"
              onClick={() => onEdit(detail.expense)}
            >
              Editar
            </button>
          )}
          {detail.type === "expense" && onDeleteExpense && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => onDeleteExpense(detail.expense)}
            >
              Excluir
            </button>
          )}
          {detail.type === "transfer" && onDeleteTransfer && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => onDeleteTransfer(detail.transfer)}
            >
              Excluir
            </button>
          )}
          {detail.type === "reserve" && onDeleteReserveMove && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => onDeleteReserveMove(detail.reserveMove)}
            >
              Excluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
