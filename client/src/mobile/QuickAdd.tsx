import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ExpenseModal } from "../components/ExpenseModal";
import { ModalForm } from "../components/ModalForm";
import { api } from "../lib/api";
import { currentMonth, money, parseMoneyInput, today } from "../lib/format";
import { notifyDataChanged } from "../lib/refresh";
import { useDescriptionSuggestions } from "../lib/useDescriptionSuggestions";
import type { Account, Card, Category, Reserve } from "../types";

type Action = null | "menu" | "expense" | "income" | "transfer" | "reserve";

export function QuickAdd() {
  const [params] = useSearchParams();
  const monthParam = params.get("month");
  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth();
  const [action, setAction] = useState<Action>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const { suggestions: incomeDescriptions, remember: rememberIncome } =
    useDescriptionSuggestions("income");

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const [accs, cds, cats, ress] = await Promise.all([
          api.get<Account[]>("/accounts"),
          api.get<Card[]>("/cards"),
          api.get<Category[]>("/categories"),
          api.get<Reserve[]>("/reserves"),
        ]);
        if (cancel) return;
        setAccounts(accs);
        setCards(cds);
        setCategories(cats);
        setReserves(ress);
      } catch {
        // o formulário avisa se faltar dado
      }
    })();
    return () => {
      cancel = true;
    };
  }, [action]);

  function saved() {
    notifyDataChanged();
  }

  const form =
    action === "expense" ? (
      <ExpenseModal
        month={month}
        accounts={accounts}
        cards={cards}
        categories={categories}
        reserves={reserves}
        onClose={() => setAction(null)}
        onSaved={async () => {
          saved();
        }}
      />
    ) : action === "income" ? (
      <ModalForm
        title="Nova receita"
        submitLabel="Lançar"
        continueLabel="Lançar e novo"
        onClose={() => setAction(null)}
        fields={[
          {
            name: "description",
            label: "Descrição",
            required: true,
            defaultValue: "Salário",
            clearOnContinue: true,
            suggestions: incomeDescriptions,
          },
          {
            name: "amount",
            label: "Valor (R$)",
            type: "money",
            required: true,
            placeholder: "Ex: 10.000,00",
          },
          {
            name: "account_id",
            label: "Conta",
            type: "select",
            options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
          },
          {
            name: "received_date",
            label: "Data recebimento",
            type: "date",
            defaultValue: today(),
          },
        ]}
        onSubmit={async (v) => {
          await api.post("/incomes", {
            description: v.description,
            amount: parseMoneyInput(v.amount),
            month,
            account_id: v.account_id ? Number(v.account_id) : null,
            received_date: v.received_date || null,
          });
          rememberIncome(v.description);
          saved();
        }}
      />
    ) : action === "transfer" ? (
      <ModalForm
        title="Transferir entre contas"
        submitLabel="Transferir"
        onClose={() => setAction(null)}
        fields={[
          {
            name: "from_account_id",
            label: "De",
            type: "select",
            required: true,
            options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
          },
          {
            name: "to_account_id",
            label: "Para",
            type: "select",
            required: true,
            defaultValue: accounts.length > 1 ? String(accounts[1]!.id) : "",
            options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
          },
          {
            name: "amount",
            label: "Valor (R$)",
            type: "money",
            required: true,
            placeholder: "Ex: 500,00",
          },
          {
            name: "date",
            label: "Data",
            type: "date",
            required: true,
            defaultValue: today(),
          },
          { name: "note", label: "Nota (opcional)", type: "textarea" },
        ]}
        onSubmit={async (v) => {
          const amount = parseMoneyInput(v.amount);
          if (amount <= 0) throw new Error("Informe um valor positivo");
          if (v.from_account_id === v.to_account_id) {
            throw new Error("Escolha contas de origem e destino diferentes");
          }
          await api.post("/account-transfers", {
            from_account_id: Number(v.from_account_id),
            to_account_id: Number(v.to_account_id),
            amount,
            date: v.date,
            note: v.note || null,
          });
          saved();
        }}
      />
    ) : action === "reserve" ? (
      <ModalForm
        title="Reservar"
        submitLabel="Confirmar"
        onClose={() => setAction(null)}
        fields={[
          {
            name: "direction",
            label: "Movimento",
            type: "select",
            required: true,
            defaultValue: "in",
            options: [
              { value: "in", label: "Guardar (conta → reserva)" },
              { value: "out", label: "Resgatar (reserva → conta)" },
            ],
          },
          {
            name: "reserve_id",
            label: "Reserva",
            type: "select",
            required: true,
            options: reserves.map((r) => ({
              value: String(r.id),
              label: `${r.name} (${money(r.current_amount)})`,
            })),
          },
          {
            name: "account_id",
            label: "Conta corrente",
            type: "select",
            required: true,
            options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
          },
          {
            name: "amount",
            label: "Valor (R$)",
            type: "money",
            required: true,
            placeholder: "Ex: 200,00",
          },
          {
            name: "date",
            label: "Data",
            type: "date",
            required: true,
            defaultValue: today(),
          },
          { name: "note", label: "Nota (opcional)", type: "textarea" },
        ]}
        onSubmit={async (v) => {
          const amount = parseMoneyInput(v.amount);
          if (amount <= 0) throw new Error("Informe um valor positivo");
          await api.post(`/reserves/${v.reserve_id}/move`, {
            direction: v.direction,
            account_id: Number(v.account_id),
            amount,
            date: v.date,
            note: v.note || null,
          });
          saved();
        }}
      />
    ) : null;

  return (
    <>
      {action === "menu" && (
        <button
          type="button"
          className="fab-scrim"
          aria-label="Fechar"
          onClick={() => setAction(null)}
        />
      )}
      {!form && (
        <div className="fab-wrap">
          {action === "menu" && (
            <div className="fab-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => setAction("expense")}>
                Gasto
              </button>
              <button type="button" role="menuitem" onClick={() => setAction("income")}>
                Receita
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={accounts.length < 2}
                onClick={() => setAction("transfer")}
              >
                Transferir
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={reserves.length === 0 || accounts.length === 0}
                onClick={() => setAction("reserve")}
              >
                Reservar
              </button>
            </div>
          )}
          <button
            type="button"
            className={action === "menu" ? "fab open" : "fab"}
            aria-expanded={action === "menu"}
            aria-label={action === "menu" ? "Fechar" : "Novo lançamento"}
            onClick={() => setAction((cur) => (cur === "menu" ? null : "menu"))}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      )}
      {form}
    </>
  );
}
