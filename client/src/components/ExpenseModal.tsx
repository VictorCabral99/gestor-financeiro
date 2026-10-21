import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, QueuedSyncError } from "../lib/api";
import {
  currentMonth,
  formatDateBr,
  parseDateBr,
  maskMoneyInput,
  parseMoneyInput,
  today,
} from "../lib/format";
import { categorySelectOptions } from "../lib/categories";
import { useDescriptionSuggestions } from "../lib/useDescriptionSuggestions";
import type { Account, Card, Category, Reserve } from "../types";

type Props = {
  month: string;
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  reserves: Reserve[];
  onClose: () => void;
  onSaved: (created?: { invoice_id?: number | null }) => Promise<void>;
  /** Prefere cartão ao abrir (ex.: tela de Cartões). */
  defaultPayWith?: PayWith;
  defaultCardId?: number | null;
  /** Esconde o seletor conta/cartão e força o default. */
  lockPayWith?: boolean;
  /**
   * Fatura alvo (tela de Cartões). A data da compra não muda o ciclo —
   * a compra entra nesta fatura.
   */
  invoiceId?: number | null;
  /** Vencimento da fatura (exibido como label na compra no cartão). */
  invoiceDueDate?: string | null;
};

type Kind = "single" | "fixed_eternal" | "fixed_installment";
type PayWith = "account" | "card";

export function ExpenseModal({
  month,
  accounts,
  cards,
  categories,
  reserves,
  onClose,
  onSaved,
  defaultPayWith = "account",
  defaultCardId = null,
  lockPayWith = false,
  invoiceId = null,
  invoiceDueDate = null,
}: Props) {
  const [kind, setKind] = useState<Kind>("single");
  const [payWith, setPayWith] = useState<PayWith>(defaultPayWith);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  /** Data única da esporádica (vencimento = pagamento). */
  const [occurredDate, setOccurredDate] = useState(() => formatDateBr(today()));
  const [dueDay, setDueDay] = useState("10");
  const [startMonth, setStartMonth] = useState(month || currentMonth());
  const [installmentsTotal, setInstallmentsTotal] = useState("");
  const [installmentFrom, setInstallmentFrom] = useState("1");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState(() =>
    defaultCardId != null ? String(defaultCardId) : "",
  );
  const [reserveId, setReserveId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const descRef = useRef<HTMLInputElement>(null);
  const { suggestions, remember } = useDescriptionSuggestions("expense");

  const categoryOptions = useMemo(
    () => categorySelectOptions(categories),
    [categories],
  );

  /** No cartão o vencimento é o da fatura (não pedimos dia). */
  const cardInvoiceDueDay = useMemo(() => {
    if (invoiceDueDate && /^\d{4}-\d{2}-\d{2}/.test(invoiceDueDate)) {
      return Number(invoiceDueDate.slice(8, 10));
    }
    const card = cards.find((c) => c.id === Number(cardId));
    return card?.due_day ?? (Number(dueDay) || 10);
  }, [invoiceDueDate, cards, cardId, dueDay]);

  function resetForNext() {
    setDescription("");
    setAmount("");
    setOccurredDate(formatDateBr(today()));
    setInstallmentsTotal("");
    setInstallmentFrom("1");
    setReserveId("");
    setError(null);
    setJustSaved(true);
    requestAnimationFrame(() => descRef.current?.focus());
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as
      | HTMLButtonElement
      | null;
    const andNew = submitter?.value === "and-new";

    setBusy(true);
    setError(null);
    setJustSaved(false);

    const parsedAmount = parseMoneyInput(amount);
    if (!description.trim()) {
      setError("Informe a descrição");
      setBusy(false);
      return;
    }
    if (parsedAmount <= 0) {
      setError("Informe um valor válido");
      setBusy(false);
      return;
    }
    if (payWith === "card" && !cardId) {
      setError("Selecione o cartão");
      setBusy(false);
      return;
    }
    if (payWith === "account" && !accountId) {
      setError("Selecione a conta");
      setBusy(false);
      return;
    }
    if (kind === "fixed_installment" && !installmentsTotal) {
      setError("Informe o número total de parcelas");
      setBusy(false);
      return;
    }
    if (
      kind === "fixed_installment" &&
      Number(installmentFrom) > Number(installmentsTotal)
    ) {
      setError("Parcela atual não pode ser maior que o total");
      setBusy(false);
      return;
    }

    let occurredIso: string | null = null;
    if (kind === "single") {
      occurredIso = occurredDate.trim() ? parseDateBr(occurredDate) : null;
      if (!occurredIso) {
        setError("Data inválida — use dd/mm/aaaa");
        setBusy(false);
        return;
      }
    }

    try {
      const category_id = categoryId ? Number(categoryId) : null;
      const reserve_id =
        payWith === "account" && reserveId ? Number(reserveId) : null;
      const account_id = payWith === "account" ? Number(accountId) : null;
      const card_id = payWith === "card" ? Number(cardId) : null;

      let created: { invoice_id?: number | null } | undefined;

      if (kind === "single") {
        // Conta: data = pago. Cartão: data da compra; fatura = invoiceId (tela Cartões) ou ciclo automático.
        created = await api.post<{ invoice_id: number | null }>("/expenses", {
          description: description.trim(),
          amount: parsedAmount,
          month,
          inclusion_date: occurredIso,
          due_date: payWith === "account" ? occurredIso : null,
          category_id,
          account_id,
          card_id,
          reserve_id,
          ...(payWith === "card" && invoiceId != null ? { invoice_id: invoiceId } : {}),
          ...(payWith === "account"
            ? { status: "paid", payment_date: occurredIso }
            : { status: "pending" }),
        });
      } else {
        let purchaseIso: string | null = null;
        if (kind === "fixed_installment" && payWith === "card") {
          purchaseIso = occurredDate.trim() ? parseDateBr(occurredDate) : null;
          if (!purchaseIso) {
            setError("Data da compra inválida — use dd/mm/aaaa");
            setBusy(false);
            return;
          }
        }
        await api.post("/expense-rules", {
          description: description.trim(),
          type: kind,
          amount: parsedAmount,
          start_month: startMonth,
          installments_total:
            kind === "fixed_installment" ? Number(installmentsTotal) : null,
          installment_from:
            kind === "fixed_installment" ? Number(installmentFrom) || 1 : 1,
          due_day:
            payWith === "card" ? cardInvoiceDueDay : Number(dueDay) || 10,
          category_id,
          account_id,
          card_id,
          reserve_id,
          ...(purchaseIso ? { purchase_date: purchaseIso } : {}),
        });
      }

      await onSaved(created);
      remember(description.trim());

      if (andNew) {
        resetForNext();
      } else {
        onClose();
      }
    } catch (err) {
      if (err instanceof QueuedSyncError) {
        await onSaved(undefined);
        remember(description.trim());
        if (andNew) resetForNext();
        else onClose();
        return;
      }
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{lockPayWith || invoiceId != null ? "Nova compra" : "Novo gasto"}</h3>
        {justSaved && (
          <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
            Lançado. Pode registrar o próximo.
          </p>
        )}
        {error && <div className="error">{error}</div>}
        <form className="form" onSubmit={handleSubmit}>
          <div className="field">
            <label>Tipo</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="single">Único / esporádico</option>
              <option value="fixed_eternal">Fixo eterno</option>
              <option value="fixed_installment">Parcelado</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="exp-desc">Descrição</label>
            <input
              id="exp-desc"
              ref={descRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              list="expense-desc-suggestions"
              autoComplete="off"
              required
              autoFocus
            />
            {suggestions.length > 0 && (
              <datalist id="expense-desc-suggestions">
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </div>

          <div className="field">
            <label htmlFor="exp-amount">Valor (R$)</label>
            <input
              id="exp-amount"
              value={amount}
              onChange={(e) => setAmount(maskMoneyInput(e.target.value))}
              inputMode="numeric"
              placeholder="0,00"
              required
            />
          </div>

          {kind !== "single" && (
            <>
              <div className="field">
                <label htmlFor="exp-start">Mês início</label>
                <input
                  id="exp-start"
                  type="month"
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                  required
                />
              </div>
              {payWith !== "card" && (
                <div className="field">
                  <label htmlFor="exp-dueday">Dia de vencimento</label>
                  <input
                    id="exp-dueday"
                    type="number"
                    min={1}
                    max={31}
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    required
                  />
                </div>
              )}
              {kind === "fixed_installment" && (
                <>
                  <div className="field">
                    <label htmlFor="exp-parcels">Total de parcelas</label>
                    <input
                      id="exp-parcels"
                      type="number"
                      min={1}
                      value={installmentsTotal}
                      onChange={(e) => setInstallmentsTotal(e.target.value)}
                      required
                      placeholder="Ex: 8"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="exp-from">Parcela atual</label>
                    <input
                      id="exp-from"
                      type="number"
                      min={1}
                      value={installmentFrom}
                      onChange={(e) => setInstallmentFrom(e.target.value)}
                      required
                      placeholder="Ex: 4"
                    />
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      Se já pagou 3 de 8, informe 4. As anteriores não são criadas.
                    </span>
                  </div>
                </>
              )}
            </>
          )}

          {!lockPayWith && (
            <div className="field">
              <label>Pago com</label>
              <select
                value={payWith}
                onChange={(e) => {
                  const next = e.target.value as PayWith;
                  setPayWith(next);
                  if (next === "card") setAccountId("");
                  else setCardId("");
                }}
              >
                <option value="account">Conta corrente</option>
                <option value="card">Cartão de crédito</option>
              </select>
            </div>
          )}

          {payWith === "account" ? (
            <div className="field">
              <label htmlFor="exp-account">Conta</label>
              <select
                id="exp-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
              >
                <option value="">—</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : lockPayWith ? (
            <div className="field">
              <label htmlFor="exp-card">Cartão</label>
              <select
                id="exp-card"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
                required
              >
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                A conta só será pedida no pagamento da fatura.
              </span>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="exp-card">Cartão</label>
              <select
                id="exp-card"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
                required
              >
                <option value="">—</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                A conta só será pedida no pagamento da fatura.
              </span>
            </div>
          )}

          {(kind === "single" ||
            (kind === "fixed_installment" && payWith === "card")) && (
            <div className="field">
              <label htmlFor="exp-date">
                {payWith === "card" ? "Data da compra" : "Data"}
              </label>
              <input
                id="exp-date"
                type="text"
                inputMode="numeric"
                placeholder="dd/mm/aaaa"
                value={occurredDate}
                onChange={(e) => setOccurredDate(e.target.value)}
                required
              />
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {kind === "fixed_installment" && payWith === "card"
                  ? "Mesma data em todas as parcelas — cada uma entra na fatura do mês correspondente."
                  : payWith === "card"
                    ? invoiceId != null
                      ? "Data em que comprou — a fatura é a selecionada na tela de Cartões."
                      : "Sem fatura escolhida: entra no ciclo pelo dia de fechamento do cartão."
                    : "Esporádica na conta: paga no mesmo dia."}
              </span>
            </div>
          )}

          {payWith === "card" && invoiceDueDate && (
            <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
              Vencimento: <strong>{formatDateBr(invoiceDueDate)}</strong>
              {" "}(mesmo da fatura)
            </p>
          )}

          {payWith === "card" && kind === "fixed_installment" && (
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              Cada parcela entra na fatura do mês correspondente. A conta é
              debitada só quando você pagar a fatura.
            </p>
          )}

          <div className="field">
            <label htmlFor="exp-cat">Categoria</label>
            <select
              id="exp-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">—</option>
              {categoryOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {payWith === "account" && (
            <div className="field">
              <label htmlFor="exp-reserve">Usar reserva (opcional)</label>
              <select
                id="exp-reserve"
                value={reserveId}
                onChange={(e) => setReserveId(e.target.value)}
              >
                <option value="">—</option>
                {reserves.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Fechar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              name="intent"
              value="done"
              disabled={busy}
            >
              {busy ? "Salvando…" : "Lançar"}
            </button>
            <button
              type="submit"
              className="btn"
              name="intent"
              value="and-new"
              disabled={busy}
            >
              {busy ? "Salvando…" : "Lançar e novo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
