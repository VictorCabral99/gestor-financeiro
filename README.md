# Gestor Financeiro

Sistema de gestão financeira **pessoal** e **local**, com **vários perfis** (cada pessoa tem o próprio banco SQLite).

Uso diário: abrir o mês atual, ver saldos, lançar gastos e receitas, marcar pagamentos, acompanhar cartões, reservas e o fechamento automático do mês.

---

## Sumário

1. [Como rodar](#como-rodar)
2. [Launcher desktop (Windows)](#launcher-desktop-windows)
3. [Stack](#stack)
4. [Regras de negócio](#regras-de-negócio)
5. [Telas](#telas)
6. [Domínio e modelo de dados](#domínio-e-modelo-de-dados)
7. [API](#api)
8. [UX e convenções de interface](#ux-e-convenções-de-interface)
9. [Estrutura do repositório](#estrutura-do-repositório)
10. [Decisões de produto](#decisões-de-produto)

---

## Como rodar

Pré-requisito: Node.js (projeto testado com stack moderna; SQLite via `node:sqlite`, sem `better-sqlite3`).

```bash
# na raiz
npm run install:all
npm run dev
```

| Serviço | URL |
|---------|-----|
| UI (Vite) | http://localhost:5173 |
| API (Express) | http://localhost:3333 |

O Vite faz proxy de `/api` → `http://localhost:3333`.

Scripts úteis:

| Script | O que faz |
|--------|-----------|
| `npm run install:all` | Instala raiz + `server` + `client` |
| `npm run dev` | Sobe API e UI juntos (`concurrently`) |
| `npm run build` | Build do client + server (copia `schema.sql`) |
| `npm run start` | Sobe o server compilado (API + UI estática em `http://127.0.0.1:3333`) |
| `npm test` | Testes do núcleo financeiro (server) |
| `npm --prefix server run dev` | Só a API |
| `npm --prefix client run dev` | Só a UI |

Banco: `server/data/gestor.db` (criado automaticamente na primeira execução).

Produção local:

```bash
npm run build
npm start
```

A API escuta em `127.0.0.1` por padrão (`HOST` / `PORT` via env). Em dev, continue usando `npm run dev` (Vite na 5173).

Na tela **Cadastros**:

- **Seed categorias** — cria árvore inicial (só se não houver categorias)
- **Backup DB** — copia o SQLite para `server/data/backups/`
- **Restaurar** — substitui o banco por um backup (cria snapshot `pre-restore-*` antes)

---

## Launcher desktop (Windows)

Pasta [`scripts/`](scripts/):

| Arquivo | Função |
|---------|--------|
| `start-gestor.ps1` | Sobe API/UI se necessário, abre Brave/Chrome/Edge em modo app (`--app=http://127.0.0.1:5473`) e encerra os serviços que o launcher iniciou ao fechar a janela |
| `start-gestor.bat` / `start-gestor.vbs` | Atalhos para o PowerShell (VBS sem console) |
| `run-api.cmd` / `run-ui.cmd` | Processos auxiliares (janelas minimizadas) |

Uso típico: criar atalho para `start-gestor.vbs` na área de trabalho.

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Monorepo | `client/` + `server/` (scripts na raiz) |
| Backend | Node.js + Express + TypeScript (`tsx` no dev) |
| Banco | SQLite nativo (`node:sqlite` / `DatabaseSync`), WAL, `foreign_keys` |
| Validação | Zod |
| Datas (server) | dayjs |
| Frontend | React 19 + Vite + React Router + Recharts |
| Dinheiro | sempre **centavos** (`INTEGER`) |
| Datas | ISO `YYYY-MM-DD`; mês `YYYY-MM` |

> `better-sqlite3` foi descartado (build nativo no Windows). O schema vive em [`server/src/schema.sql`](server/src/schema.sql).

---

## Regras de negócio

### Mês e fechamento

- Controle por mês (`YYYY-MM`), status `open` | `closed`.
- Ao subir a API (e em `GET /api/dashboard` / sync de meses), `syncMonths()`:
  1. fecha meses `open` **anteriores** ao mês calendário atual;
  2. abre o mês atual;
  3. gera lançamentos das regras de despesa fixa ativas até dezembro do ano corrente.
- Na virada do ano, o sync gera Jan–Dez do novo ano para regras ativas.
- **Meses fechados são imutáveis**: criar/editar/excluir/pagar lançamentos, ajustes, transferências, movimentos de reserva e pagamentos de fatura nesses meses retorna erro 400.

### Lente compartilhada (Contas · Cartões · Tudo)

Mês, Movimentações e Ano usam a mesma lente na URL: `canal` + `base`.

| Canal | Base | Significado |
|-------|------|-------------|
| `contas` | `compra` (padrão) | Lançamentos do mês na conta |
| `contas` | `caixa` | O que saiu da conta (pagamentos) |
| `cartoes` | `compra` (padrão) | Compras pela **data da compra** (`inclusion_date`) |
| `cartoes` | `fatura` | Compras no mês da fatura (vencimento) |
| `cartoes` | `caixa` | Pagamentos de fatura |
| `tudo` | `compra` (padrão) | Conta no mês + compras no cartão pela data |
| `tudo` | `fatura` / `caixa` | Agregado pela fatura ou pela saída de caixa |

A tela **Cartões** (`/faturas`) continua especialista em operar o ciclo (fechar/pagar).

### Contas

Saldo calculado:

```
opening_balance
+ receitas na conta
− despesas pagas debitadas na conta (sem cartão)
− pagamentos de fatura
± ajustes manuais
```

Disponível: igual ao `balance` (o valor nas reservas já saiu da conta via ajustes ao guardar).

Correção pontual: **Ajustar saldo** — você informa o saldo desejado (ex.: o do extrato); o sistema calcula a diferença em relação ao saldo atual do app e cria o ajuste (`POST /api/accounts/:id/set-balance`).

**Transferência entre contas:** `POST /api/account-transfers` gera dois ajustes ligados (`transfer_id`) — débito na origem e crédito no destino — na mesma data. UI em Cadastros → Contas → **Transferir**.

### Cartões e faturas

- Despesa no cartão **não** debita a conta no ato: só consome limite e entra na fatura.
- Ciclo: mês da fatura = mês do **vencimento** (ex.: “fatura de agosto”).
- Se `due_day <= closing_day` (ex.: Nubank fecha 29, vence 5), o **fechamento** fica no **mês anterior** ao da fatura (agosto fecha 29/07 e vence 05/08).
- Se `due_day > closing_day` (ex.: Unique fecha 11, vence 18), fechamento e vencimento ficam no **mesmo mês** da fatura.
- Compra após o dia de fechamento do ciclo cai na fatura seguinte (quando lançada sem fatura explícita).
- Na tela de Cartões, a fatura selecionada manda — a data da compra não troca o ciclo.
- Dias 29/30/31 são limitados ao último dia do mês (fevereiro inclusive).
- Pagamento total ou parcial debita a conta escolhida (`POST /api/card-invoices/:id/pay`).
- Tela **Cartões** (`/faturas`): escolha o cartão e o mês da fatura, veja as compras, **feche** o ciclo (`POST /close`) e **pague** debitando a conta.

### Reservas

| Tipo | Uso |
|------|-----|
| `investment` | Futuro / investimentos |
| `future_expense` | Separação de gasto futuro (ex.: almoços) |

- Campos: meta (`target_amount`), valor guardado (`current_amount`), conta opcional.
- **Guardar** (conta → reserva): debita a conta e aumenta a reserva; aparece em Movimentações.
- **Resgatar** (reserva → conta): reduz a reserva e credita a conta.
- API: `POST /api/reserves/:id/move` (`direction`: `in` \| `out`), `GET /api/reserves/movements?month=`.
- Ao pagar despesa usando reserva, o valor sai só da reserva (já tinha saído da conta ao guardar).
- Disponível na conta = saldo após os movimentos (dinheiro guardado não fica “duplicado”).

### Categorias

- Árvore `parent_id` (categoria → subcategoria).
- Cor distinta por categoria (paleta + escolha automática ao criar).
- Gráficos e visão anual **somam subcategorias no pai**.

### Despesas e regras fixas

| Origem | Comportamento |
|--------|----------------|
| `single` | Única / esporádica |
| `fixed_eternal` | Regra sem fim; gera lançamento por mês |
| `fixed_installment` | Parcelado com fim (`start_month`, `installments_total`, `installment_from`) |

- Cada mês tem um **lançamento** editável (`amount` por parcela).
- Datas: inclusão, vencimento, pagamento; status `pending` | `paid`.
- Editar valor do fixo: escopo **só esta** ou **esta e as futuras** (atualiza a regra).
- Excluir fixo: **só este mês** | **este e próximos** | **todos** (usa skips / apaga gerados).

Fluxo dos fixos:

1. Cadastrar a regra (ou pelo modal “Novo gasto” → fixo).
2. Sync gera lançamentos do início até dez. do ano corrente.
3. Parcelado: informar parcela atual (ex.: 4 de 8) — anteriores não são criadas.

### Esporádica (UX de lançamento)

- **Na conta**: uma única **Data** = vencimento e pagamento; já entra como **paga** (esporádicas na conta raramente têm vencimento ≠ pagamento).
- **No cartão**: sem data de pagamento agora — o valor vai para a fatura.

---

## Telas

| Rota | Tela | Função |
|------|------|--------|
| `/` | **Mês** | Totais do mês, saldos de contas/cartões/reservas, pizza por categoria pai, vencidos, receitas, atalho para novo gasto |
| `/despesas` | **Movimentações** | Conta, cartão (compras/parcelas), pagamento de fatura, transferências e reservas |
| `/ano` | **Ano** | Totais por mês + despesas agregadas por categoria pai |
| `/faturas` | **Cartões** | Movimentações da fatura por cartão/mês; fechar e pagar |
| `/cadastros` | **Cadastros** | Contas, cartões, reservas, categorias, regras fixas; seed e backup |
| `/historico` | **Histórico** | Meses abertos/fechados |

Query `?month=YYYY-MM` nas telas Mês e Despesas.

---

## Domínio e modelo de dados

Schema: [`server/src/schema.sql`](server/src/schema.sql).

### Tabelas

| Tabela | Papel |
|--------|-------|
| `accounts` | Contas correntes (`opening_balance`, `archived`) |
| `cards` | Cartões (`credit_limit`, `closing_day`, `due_day`) |
| `reserves` | Reservas (`investment` \| `future_expense`) |
| `categories` | Categorias / subcategorias + `color` |
| `months` | Controle mensal (`open` \| `closed`, `closed_at`) |
| `incomes` | Receitas do mês |
| `account_adjustments` | Correções de saldo |
| `expense_rules` | Regras de fixo eterno/parcelado |
| `expense_rule_skips` | Meses pulados de uma regra |
| `expenses` | Lançamentos (`kind`, `reserve_id`, `invoice_id`, datas, parcelas) |
| `card_invoices` | Faturas por cartão + mês |
| `card_invoice_payments` | Pagamentos de fatura (debitam conta) |

Convenções:

- Dinheiro em **centavos**.
- Soft archive via `archived` onde faz sentido.
- DB em `server/data/gestor.db`; migração leve de colunas novas no bootstrap (`server/src/db.ts`).

---

## API

Prefixo: `/api`. Health: `GET /api/health`.

| Grupo | Endpoints principais |
|-------|----------------------|
| Perfis | `GET/POST /profiles`, `PATCH/DELETE /profiles/:id` (header `X-Profile-Id` isola o restante da API) |
| Contas | `GET/POST /accounts`, `PATCH /accounts/:id`, `GET /accounts/:id/balance` |
| Ajustes | `GET/POST /account-adjustments`, `DELETE /account-adjustments/:id` |
| Transferências | `GET/POST /account-transfers`, `DELETE /account-transfers/:id` |
| Cartões | `GET/POST /cards`, `PATCH /cards/:id`, `GET /cards/:id/summary`, `GET /cards/:id/invoices` |
| Faturas | `GET /card-invoices/:id` (compras + pagamentos), `POST /:id/close`, `POST /:id/reopen`, `POST /:id/pay` |
| Reservas | `GET/POST /reserves`, `PATCH /reserves/:id`, `POST /reserves/:id/move`, `GET /reserves/movements`, `DELETE /reserves/movements/:id` |
| Categorias | `GET/POST /categories`, `PATCH /categories/:id` |
| Meses | `GET /months`, `GET /months/current`, `POST /months/sync` |
| Receitas | `GET/POST /incomes?month=`, `PATCH/DELETE /incomes/:id`, `GET /incomes/descriptions` |
| Regras | `GET/POST /expense-rules`, `PATCH /expense-rules/:id` |
| Despesas | `GET/POST /expenses?month=`, `PATCH/DELETE /expenses/:id`, `POST /expenses/:id/pay`, `POST /expenses/:id/unpay`, `GET /expenses/descriptions` |
| Dashboard | `GET /dashboard?month=&canal=&base=`, `GET /dashboard/year?year=&canal=&base=` |
| Despesas (lente) | `GET /expenses?month=&canal=&base=` |
| Seed | `POST /seed/categories` |
| Backup | `POST /backup`, `GET /backup`, `POST /backup/restore` `{ filename }` |

Rotas de código: `server/src/routes/*` · serviços: `server/src/services/*`.

---

## UX e convenções de interface

### Formatação (pt-BR)

- **Datas**: exibição e digitação `dd/mm/aaaa`; persistência ISO `YYYY-MM-DD` (`client/src/lib/format.ts`).
- **Dinheiro**: aceita `10.000`, `10.000,00`, `10,50`, etc. → centavos; exibe com `Intl` pt-BR.

### Lançamentos em sequência

- Botão **Lançar e novo** em gastos e receitas: salva, limpa descrição/valor e mantém conta/cartão/categoria para o próximo.
- **Lançar** (ou Enter) fecha o modal.

### Autocomplete de descrições

- Sugestões a partir de descrições já usadas (`GET /expenses/descriptions`, `GET /incomes/descriptions`), ordenadas por frequência.
- Hook: `client/src/lib/useDescriptionSuggestions.ts` + `<datalist>`.

### Categorias e cores

- Paleta distinta; ao criar, escolhe cor ainda não usada.
- No bootstrap do DB, categorias com a **mesma cor** recebem cores diferentes automaticamente.

### Visão por categoria

- Tela do mês (pizza) e tela do ano: totais no **pai** (subcategoria soma na raiz).

### Despesa esporádica

- Conta → uma data, já paga.
- Cartão → entra na fatura (pagamento só na tela de faturas).

---

## Estrutura do repositório

```
gestor-financeiro/
├── package.json              # scripts da raiz (dev, install:all)
├── README.md
├── scripts/                  # launcher Windows
├── server/
│   ├── data/                 # gestor.db + backups/ (gerado)
│   └── src/
│       ├── index.ts          # Express
│       ├── db.ts             # SQLite + migrações leves
│       ├── schema.sql
│       ├── paths.ts
│       ├── lib/              # Zod schemas, datas, cores, HTTP
│       ├── routes/
│       └── services/         # meses, despesas, saldos, faturas
└── client/
    └── src/
        ├── App.tsx           # rotas
        ├── pages/            # Mês, Despesas, Ano, Faturas, Cadastros, Histórico
        ├── components/       # ExpenseModal, ModalForm, PieChart, …
        └── lib/              # api, format, categories, suggestions
```

---

## Decisões de produto

Fechadas em 2026-07-21:

| Tema | Escolha |
|------|---------|
| Multi-perfil | Um SQLite por pessoa (`profiles.json` + `gestor*.db`); troca na topbar |
| Fechamento dia 01 | Automático ao abrir/sincronizar (fecha meses anteriores ainda `open`) |
| Saldo da conta | Calculado, com ajuste manual pontual |
| Reserva de gasto futuro | Opcional ao lançar/pagar (“usar desta reserva”) |
| Cartão | Consome limite; pagamento da fatura (total/parcial) debita a conta |

---

## Estado atual

Aplicação **utilizável no dia a dia** com:

- CRUD completo (contas, cartões, reservas, categorias, receitas, despesas, regras, faturas)
- Multi-perfil (sessão isolada por pessoa)
- Sync de mês + geração de fixos até o fim do ano
- Dashboard mensal e anual
- UI React com as seis telas acima
- Seed, backup/restore, launcher desktop, formatação pt-BR, autocomplete e “lançar e novo”
- Build de produção (API + UI estática), testes do núcleo, trava de mês fechado

Ideias futuras (não implementadas): export CSV, edição mais rica de regras inline, relatórios extras.
