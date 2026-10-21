import { useCallback, useEffect, useState } from "react";
import { ModalForm } from "../components/ModalForm";
import { api } from "../lib/api";
import { currentMonth, money, moneyInput, parseMoneyInput, today } from "../lib/format";
import { categorySelectOptions, sortCategoriesTree } from "../lib/categories";
import { pickCategoryColor } from "../lib/categoryColors";
import { useDescriptionSuggestions } from "../lib/useDescriptionSuggestions";
import type { Account, AccountBalance, Card, Category, ExpenseRule, Reserve } from "../types";

type Tab = "accounts" | "cards" | "reserves" | "categories" | "rules";
type ModalKind =
  | null
  | "account"
  | "card"
  | "reserve"
  | "category"
  | "rule"
  | "adjustment"
  | "transfer"
  | "move-reserve";

export function SetupPage() {
  const [tab, setTab] = useState<Tab>("accounts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<ExpenseRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedReserve, setSelectedReserve] = useState<Reserve | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backups, setBackups] = useState<{ filename: string; created_at: string }[]>([]);
  const [restoreFile, setRestoreFile] = useState("");
  const { suggestions: expenseDescriptions, remember: rememberExpense } =
    useDescriptionSuggestions("expense");

  const loadBackups = useCallback(async () => {
    try {
      const list = await api.get<{ filename: string; created_at: string }[]>("/backup");
      setBackups(list);
      setRestoreFile((prev) => prev || list[0]?.filename || "");
    } catch {
      // backup list é opcional na carga
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [accs, cds, ress, cats, rls] = await Promise.all([
        api.get<Account[]>("/accounts"),
        api.get<Card[]>("/cards"),
        api.get<Reserve[]>("/reserves"),
        api.get<Category[]>("/categories"),
        api.get<ExpenseRule[]>("/expense-rules"),
      ]);
      setAccounts(accs);
      setCards(cds);
      setReserves(ress);
      setCategories(cats);
      setRules(rls);
      const bals = await Promise.all(
        accs.map((a) => api.get<AccountBalance>(`/accounts/${a.id}/balance`)),
      );
      setAccountBalances(bals);
      await loadBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, [loadBackups]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "accounts", label: "Contas" },
    { id: "cards", label: "Cartões" },
    { id: "reserves", label: "Reservas" },
    { id: "categories", label: "Categorias" },
    { id: "rules", label: "Fixos" },
  ];

  return (
    <div>
      <div className="section-head" style={{ marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "var(--display)", fontSize: "1.5rem" }}>
            Cadastros
          </h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Contas, cartões, reservas, categorias e regras fixas
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setNotice(null);
              setError(null);
              try {
                await api.post("/seed/categories", {});
                setNotice("Categorias seed criadas.");
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Falha no seed");
              }
            }}
          >
            Seed categorias
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setNotice(null);
              setError(null);
              try {
                const result = await api.post<{ filename: string }>("/backup", {});
                setNotice(`Backup salvo: ${result.filename}`);
                await loadBackups();
                setRestoreFile(result.filename);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Falha no backup");
              }
            }}
          >
            Backup DB
          </button>
          {backups.length > 0 && (
            <>
              <select
                className="input"
                style={{ width: "auto", maxWidth: "14rem" }}
                value={restoreFile}
                onChange={(e) => setRestoreFile(e.target.value)}
                title="Backup para restaurar"
              >
                {backups.map((b) => (
                  <option key={b.filename} value={b.filename}>
                    {b.filename}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  if (!restoreFile) return;
                  const ok = window.confirm(
                    `Restaurar "${restoreFile}"? O banco atual será substituído (um snapshot de segurança é criado).`,
                  );
                  if (!ok) return;
                  setNotice(null);
                  setError(null);
                  try {
                    const result = await api.post<{
                      restored: string;
                      safety_backup: string;
                    }>("/backup/restore", { filename: restoreFile });
                    setNotice(
                      `Restaurado: ${result.restored}. Segurança: ${result.safety_backup}`,
                    );
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Falha ao restaurar");
                  }
                }}
              >
                Restaurar
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div
          className="error"
          style={{ background: "var(--accent-soft)", borderColor: "#9fd3c2", color: "var(--accent)" }}
        >
          {notice}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel">
        {tab === "accounts" && (
          <>
            <div className="section-head">
              <h2>Contas correntes</h2>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  className="btn"
                  onClick={() => {
                    setSelectedAccount(null);
                    setModal("transfer");
                  }}
                  disabled={accounts.length < 2}
                >
                  Transferir
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setSelectedAccount(null);
                    setModal("adjustment");
                  }}
                >
                  Ajustar saldo
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setSelectedAccount(null);
                    setModal("account");
                  }}
                >
                  + Conta
                </button>
              </div>
            </div>
            {accounts.length === 0 ? (
              <p className="empty">Nenhuma conta cadastrada.</p>
            ) : (
              <div className="list">
                {accounts.map((a) => {
                  const bal = accountBalances.find((b) => b.account_id === a.id);
                  return (
                  <div className="row" key={a.id}>
                    <div className="row-main">
                      <strong>{a.name}</strong>
                      <span className="row-meta">
                        {bal
                          ? `Saldo atual ${money(bal.balance)}`
                          : `Saldo inicial ${money(a.opening_balance)}`}
                      </span>
                    </div>
                    <div className="row-side">
                      {bal && (
                        <span className="amount">{money(bal.balance)}</span>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setSelectedAccount(a);
                          setModal("account");
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setSelectedAccount(a);
                          setModal("transfer");
                        }}
                        disabled={accounts.length < 2}
                      >
                        Transferir
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setSelectedAccount(a);
                          setModal("adjustment");
                        }}
                      >
                        Ajustar saldo
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          if (!confirm(`Arquivar conta "${a.name}"?`)) return;
                          await api.patch(`/accounts/${a.id}`, { archived: true });
                          await load();
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === "cards" && (
          <>
            <div className="section-head">
              <h2>Cartões</h2>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSelectedCard(null);
                  setModal("card");
                }}
              >
                + Cartão
              </button>
            </div>
            {cards.length === 0 ? (
              <p className="empty">Nenhum cartão.</p>
            ) : (
              <div className="list">
                {cards.map((c) => (
                  <div className="row" key={c.id}>
                    <div className="row-main">
                      <strong>{c.name}</strong>
                      <span className="row-meta">
                        Limite {money(c.credit_limit)}
                        {c.closing_day ? ` · fecha dia ${c.closing_day}` : ""}
                        {c.due_day ? ` · vence dia ${c.due_day}` : ""}
                      </span>
                    </div>
                    <div className="row-side">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setSelectedCard(c);
                          setModal("card");
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          if (!confirm(`Arquivar cartão "${c.name}"?`)) return;
                          await api.patch(`/cards/${c.id}`, { archived: true });
                          await load();
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "reserves" && (
          <>
            <div className="section-head">
              <h2>Reservas</h2>
              <button className="btn btn-primary" onClick={() => setModal("reserve")}>
                + Reserva
              </button>
            </div>
            {reserves.length === 0 ? (
              <p className="empty">Nenhuma reserva.</p>
            ) : (
              <div className="list">
                {reserves.map((r) => (
                  <div className="row" key={r.id}>
                    <div className="row-main">
                      <strong>{r.name}</strong>
                      <span className="row-meta">
                        {r.type === "investment" ? "Investimento" : "Gasto futuro"}
                        {r.target_amount ? ` · meta ${money(r.target_amount)}` : ""}
                        {r.account_id
                          ? ` · ${accounts.find((a) => a.id === r.account_id)?.name ?? "conta"}`
                          : ""}
                      </span>
                    </div>
                    <div className="row-side">
                      <span className="amount">{money(r.current_amount)}</span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setSelectedReserve(r);
                          setModal("move-reserve");
                        }}
                      >
                        Guardar / Resgatar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        title={
                          r.current_amount !== 0
                            ? "Resgate o saldo antes de excluir"
                            : undefined
                        }
                        disabled={r.current_amount !== 0}
                        onClick={async () => {
                          if (r.current_amount !== 0) return;
                          if (!confirm(`Excluir reserva "${r.name}"?`)) return;
                          try {
                            await api.delete(`/reserves/${r.id}`);
                            await load();
                          } catch (err) {
                            alert(
                              err instanceof Error
                                ? err.message
                                : "Não foi possível excluir",
                            );
                          }
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "categories" && (
          <>
            <div className="section-head">
              <h2>Categorias</h2>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSelectedCategory(null);
                  setModal("category");
                }}
              >
                + Categoria
              </button>
            </div>
            {categories.length === 0 ? (
              <p className="empty">Nenhuma categoria.</p>
            ) : (
              <div className="list">
                {sortCategoriesTree(categories).map((c) => (
                  <div
                    className="row"
                    key={c.id}
                    style={c.parent_id ? { marginLeft: "1.25rem" } : undefined}
                  >
                    <div className="row-main">
                      <strong>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: c.color,
                            marginRight: 8,
                          }}
                        />
                        {c.parent_id ? `↳ ${c.name}` : c.name}
                      </strong>
                      <span className="row-meta">
                        {c.parent_id ? "Subcategoria" : "Categoria"}
                      </span>
                    </div>
                    <div className="row-side">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setSelectedCategory(c);
                          setModal("category");
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          const label = c.parent_id ? "subcategoria" : "categoria";
                          if (!confirm(`Arquivar ${label} "${c.name}"?`)) return;
                          await api.patch(`/categories/${c.id}`, { archived: true });
                          await load();
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "rules" && (
          <>
            <div className="section-head">
              <h2>Despesas fixas</h2>
              <button className="btn btn-primary" onClick={() => setModal("rule")}>
                + Regra
              </button>
            </div>
            {rules.length === 0 ? (
              <p className="empty">Nenhuma regra fixa.</p>
            ) : (
              <div className="list">
                {rules.map((r) => (
                  <div className="row" key={r.id}>
                    <div className="row-main">
                      <strong>{r.description}</strong>
                      <span className="row-meta">
                        {r.type === "fixed_eternal"
                          ? "Eterno"
                          : `Parcelado ${r.installment_from ?? 1}→${r.installments_total}`}
                        {` · desde ${r.start_month} · dia ${r.due_day}`}
                        {r.active ? "" : " · inativa"}
                      </span>
                    </div>
                    <div className="row-side">
                      <span className="amount">{money(r.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {modal === "account" && (
        <ModalForm
          key={selectedAccount ? `account-${selectedAccount.id}` : "account-new"}
          title={selectedAccount ? "Editar conta" : "Nova conta"}
          onClose={() => {
            setModal(null);
            setSelectedAccount(null);
          }}
          fields={[
            {
              name: "name",
              label: "Nome",
              required: true,
              defaultValue: selectedAccount?.name ?? "",
            },
            {
              name: "opening_balance",
              label: "Saldo inicial (R$)",
              type: "money",
              defaultValue: selectedAccount
                ? moneyInput(selectedAccount.opening_balance)
                : "0",
            },
          ]}
          onSubmit={async (v) => {
            const body = {
              name: v.name,
              opening_balance: parseMoneyInput(v.opening_balance || "0"),
            };
            if (selectedAccount) {
              await api.patch(`/accounts/${selectedAccount.id}`, body);
            } else {
              await api.post("/accounts", body);
            }
            setSelectedAccount(null);
            await load();
          }}
        />
      )}

      {modal === "adjustment" && (
        <ModalForm
          key={selectedAccount ? `adj-${selectedAccount.id}` : "adj-new"}
          title="Ajustar saldo da conta"
          submitLabel="Definir saldo"
          onClose={() => {
            setModal(null);
            setSelectedAccount(null);
          }}
          fields={[
            {
              name: "account_id",
              label: "Conta",
              type: "select",
              required: true,
              defaultValue: selectedAccount ? String(selectedAccount.id) : "",
              options: accounts.map((a) => {
                const bal = accountBalances.find((b) => b.account_id === a.id);
                return {
                  value: String(a.id),
                  label: bal
                    ? `${a.name} (atual ${money(bal.balance)})`
                    : a.name,
                };
              }),
            },
            {
              name: "balance",
              label: "Saldo desejado (R$)",
              type: "money",
              required: true,
              defaultValue: selectedAccount
                ? moneyInput(
                    accountBalances.find(
                      (b) => b.account_id === selectedAccount.id,
                    )?.balance ?? 0,
                  )
                : "",
              placeholder: "Ex: 1.250,45",
            },
            {
              name: "date",
              label: "Data do ajuste",
              type: "date",
              required: true,
              defaultValue: today(),
            },
            {
              name: "note",
              label: "Nota (opcional)",
              type: "textarea",
              placeholder: "Ex: conferência com extrato",
            },
          ]}
          onSubmit={async (v) => {
            const accountId = Number(v.account_id);
            const target = parseMoneyInput(v.balance);
            const result = await api.post<{
              delta: number;
              before: number;
              after: number;
              message?: string;
            }>(`/accounts/${accountId}/set-balance`, {
              balance: target,
              date: v.date,
              note: v.note || null,
            });
            setSelectedAccount(null);
            if (result.delta === 0) {
              setNotice(result.message ?? "Saldo já estava correto.");
            } else {
              const sinal = result.delta > 0 ? "+" : "";
              setNotice(
                `Saldo ajustado: ${money(result.before)} → ${money(result.after)} (${sinal}${money(result.delta)}).`,
              );
            }
            await load();
          }}
        />
      )}

      {modal === "transfer" && (
        <ModalForm
          key={selectedAccount ? `tr-${selectedAccount.id}` : "tr-new"}
          title="Transferir entre contas"
          submitLabel="Transferir"
          onClose={() => {
            setModal(null);
            setSelectedAccount(null);
          }}
          fields={[
            {
              name: "from_account_id",
              label: "De",
              type: "select",
              required: true,
              defaultValue: selectedAccount ? String(selectedAccount.id) : "",
              options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
            },
            {
              name: "to_account_id",
              label: "Para",
              type: "select",
              required: true,
              defaultValue: selectedAccount
                ? String(
                    accounts.find((a) => a.id !== selectedAccount.id)?.id ?? "",
                  )
                : "",
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
            setSelectedAccount(null);
            await load();
          }}
        />
      )}

      {modal === "card" && (
        <ModalForm
          key={selectedCard ? `card-${selectedCard.id}` : "card-new"}
          title={selectedCard ? "Editar cartão" : "Novo cartão"}
          onClose={() => {
            setModal(null);
            setSelectedCard(null);
          }}
          fields={[
            {
              name: "name",
              label: "Nome",
              required: true,
              defaultValue: selectedCard?.name ?? "",
            },
            {
              name: "credit_limit",
              label: "Limite (R$)",
              type: "money",
              required: true,
              defaultValue: selectedCard ? moneyInput(selectedCard.credit_limit) : "",
            },
            {
              name: "closing_day",
              label: "Dia fechamento",
              type: "number",
              defaultValue: selectedCard?.closing_day != null ? String(selectedCard.closing_day) : "",
            },
            {
              name: "due_day",
              label: "Dia vencimento",
              type: "number",
              defaultValue: selectedCard?.due_day != null ? String(selectedCard.due_day) : "",
            },
          ]}
          onSubmit={async (v) => {
            const body = {
              name: v.name,
              credit_limit: parseMoneyInput(v.credit_limit),
              closing_day: v.closing_day ? Number(v.closing_day) : null,
              due_day: v.due_day ? Number(v.due_day) : null,
            };
            if (selectedCard) {
              await api.patch(`/cards/${selectedCard.id}`, body);
            } else {
              await api.post("/cards", body);
            }
            setSelectedCard(null);
            await load();
          }}
        />
      )}

      {modal === "reserve" && (
        <ModalForm
          title="Nova reserva"
          onClose={() => setModal(null)}
          fields={[
            { name: "name", label: "Nome", required: true },
            {
              name: "type",
              label: "Tipo",
              type: "select",
              required: true,
              defaultValue: "future_expense",
              options: [
                { value: "future_expense", label: "Gasto futuro" },
                { value: "investment", label: "Investimento" },
              ],
            },
            { name: "target_amount", label: "Meta (R$)", type: "money", defaultValue: "0" },
            {
              name: "current_amount",
              label: "Guardar agora (R$) — debita a conta",
              type: "money",
              defaultValue: "0",
            },
            {
              name: "account_id",
              label: "Conta (obrigatória se guardar agora)",
              type: "select",
              options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
            },
            { name: "note", label: "Nota", type: "textarea" },
          ]}
          onSubmit={async (v) => {
            const current = parseMoneyInput(v.current_amount || "0");
            if (current > 0 && !v.account_id) {
              throw new Error("Selecione a conta para guardar o valor na reserva");
            }
            await api.post("/reserves", {
              name: v.name,
              type: v.type,
              target_amount: parseMoneyInput(v.target_amount || "0"),
              current_amount: current,
              account_id: v.account_id ? Number(v.account_id) : null,
              note: v.note || null,
            });
            await load();
          }}
        />
      )}

      {modal === "move-reserve" && selectedReserve && (
        <ModalForm
          key={`mv-${selectedReserve.id}`}
          title={`${selectedReserve.name}`}
          submitLabel="Confirmar"
          onClose={() => {
            setModal(null);
            setSelectedReserve(null);
          }}
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
              name: "account_id",
              label: "Conta corrente",
              type: "select",
              required: true,
              defaultValue: selectedReserve.account_id
                ? String(selectedReserve.account_id)
                : "",
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
            await api.post(`/reserves/${selectedReserve.id}/move`, {
              direction: v.direction,
              account_id: Number(v.account_id),
              amount,
              date: v.date,
              note: v.note || null,
            });
            setSelectedReserve(null);
            await load();
          }}
        />
      )}

      {modal === "category" && (
        <ModalForm
          key={selectedCategory ? `cat-${selectedCategory.id}` : "cat-new"}
          title={
            selectedCategory
              ? selectedCategory.parent_id
                ? "Editar subcategoria"
                : "Editar categoria"
              : "Nova categoria"
          }
          onClose={() => {
            setModal(null);
            setSelectedCategory(null);
          }}
          fields={[
            {
              name: "name",
              label: "Nome",
              required: true,
              defaultValue: selectedCategory?.name ?? "",
            },
            {
              name: "parent_id",
              label: "Categoria pai (para subcategoria)",
              type: "select",
              defaultValue: selectedCategory?.parent_id
                ? String(selectedCategory.parent_id)
                : "",
              options: categories
                .filter((c) => !c.parent_id && c.id !== selectedCategory?.id)
                .map((c) => ({ value: String(c.id), label: c.name })),
            },
            {
              name: "color",
              label: "Cor",
              type: "color",
              defaultValue:
                selectedCategory?.color ??
                pickCategoryColor(categories.map((c) => c.color)),
            },
          ]}
          onSubmit={async (v) => {
            const body = {
              name: v.name,
              parent_id: v.parent_id ? Number(v.parent_id) : null,
              color:
                v.color ||
                pickCategoryColor(categories.map((c) => c.color)),
            };
            if (selectedCategory) {
              await api.patch(`/categories/${selectedCategory.id}`, body);
            } else {
              await api.post("/categories", body);
            }
            setSelectedCategory(null);
            await load();
          }}
        />
      )}

      {modal === "rule" && (
        <ModalForm
          title="Nova despesa fixa"
          onClose={() => setModal(null)}
          fields={[
            {
              name: "description",
              label: "Descrição",
              required: true,
              suggestions: expenseDescriptions,
            },
            {
              name: "type",
              label: "Tipo",
              type: "select",
              required: true,
              defaultValue: "fixed_eternal",
              options: [
                { value: "fixed_eternal", label: "Fixo eterno" },
                { value: "fixed_installment", label: "Parcelado com fim" },
              ],
            },
            { name: "amount", label: "Valor da parcela (R$)", type: "money", required: true },
            {
              name: "start_month",
              label: "Mês início",
              type: "month",
              required: true,
              defaultValue: currentMonth(),
            },
            {
              name: "installments_total",
              label: "Total de parcelas (se parcelado)",
              type: "number",
            },
            {
              name: "installment_from",
              label: "Parcela atual (se já pagou algumas, ex.: 4)",
              type: "number",
              defaultValue: "1",
            },
            {
              name: "due_day",
              label: "Dia vencimento",
              type: "number",
              required: true,
              defaultValue: "10",
            },
            {
              name: "purchase_date",
              label: "Data da compra (parcelado no cartão)",
              type: "date",
              defaultValue: today(),
            },
            {
              name: "category_id",
              label: "Categoria",
              type: "select",
              options: categorySelectOptions(categories),
            },
            {
              name: "account_id",
              label: "Conta",
              type: "select",
              options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
            },
            {
              name: "card_id",
              label: "Cartão",
              type: "select",
              options: cards.map((c) => ({ value: String(c.id), label: c.name })),
            },
          ]}
          onSubmit={async (v) => {
            await api.post("/expense-rules", {
              description: v.description,
              type: v.type,
              amount: parseMoneyInput(v.amount),
              start_month: v.start_month,
              installments_total: v.installments_total
                ? Number(v.installments_total)
                : null,
              installment_from: v.installment_from
                ? Number(v.installment_from)
                : 1,
              due_day: Number(v.due_day),
              category_id: v.category_id ? Number(v.category_id) : null,
              account_id: v.account_id ? Number(v.account_id) : null,
              card_id: v.card_id ? Number(v.card_id) : null,
              ...(v.type === "fixed_installment" && v.card_id && v.purchase_date
                ? { purchase_date: v.purchase_date }
                : {}),
            });
            rememberExpense(v.description);
            await load();
          }}
        />
      )}
    </div>
  );
}
