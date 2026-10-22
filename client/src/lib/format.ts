const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const MASK = "R$\u00A0••••";
let concealValues = false;

/** Só o celular liga isso, antes de desenhar a tela. */
export function setConcealValues(hidden: boolean) {
  concealValues = hidden;
}

export function valuesConcealed(): boolean {
  return concealValues;
}

/** Centavos → "R$ 1.234,56". Negativo: "R$ -1.234,56". Oculto: "R$ ••••". */
export function money(cents: number): string {
  if (concealValues) return MASK;
  const formatted = BRL.format(Math.abs(cents) / 100);
  if (cents >= 0) return formatted;
  const moved = formatted.replace(/(\s)/, "$1-");
  return moved === formatted ? formatted.replace("R$", "R$ -") : moved;
}

/** Percentual visível, ou "••" quando os valores estão ocultos. */
export function share(pct: number): string {
  return concealValues ? "••" : `${pct}%`;
}

/** Centavos → string editável pt-BR (ex: 1000000 → "10.000,00") */
export function moneyInput(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Máscara ao digitar: só números, vírgula decimal automática (centavos da direita).
 * Ex: "1" → "0,01"; "1500" → "15,00"; "100000" → "1.000,00"
 */
export function maskMoneyInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 15);
  if (!digits) return "";
  return moneyInput(Number(digits));
}

/**
 * String em formato brasileiro → centavos.
 * Aceita: "10000", "10.000", "10.000,00", "10,50", "10.5", "-150,00"
 */
export function parseMoneyInput(value: string): number {
  let cleaned = value.trim().replace(/\s/g, "").replace(/R\$\s?/i, "");
  if (!cleaned || cleaned === "-" || cleaned === "," || cleaned === ".") return 0;

  let negative = false;
  if (cleaned.startsWith("-")) {
    negative = true;
    cleaned = cleaned.slice(1);
  }

  let normalized: string;

  if (cleaned.includes(",")) {
    // BR: ponto = milhar, vírgula = decimal
    const [intPart, decPart = ""] = cleaned.split(",");
    normalized = `${intPart.replace(/\./g, "")}.${decPart.replace(/\./g, "")}`;
  } else if (cleaned.includes(".")) {
    const parts = cleaned.split(".");
    const last = parts[parts.length - 1] ?? "";
    // Um único ponto com 1–2 dígitos no final → decimal (10.5 / 10.50)
    // Caso contrário → milhar (10.000 / 1.234.567)
    if (parts.length === 2 && (last.length === 1 || last.length === 2)) {
      normalized = cleaned;
    } else {
      normalized = parts.join("");
    }
  } else {
    normalized = cleaned;
  }

  const n = Number(normalized);
  if (Number.isNaN(n)) return 0;
  const cents = Math.round(n * 100);
  return negative ? -cents : cents;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ISO (YYYY-MM-DD ou datetime) → dd/mm/aaaa */
export function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.slice(0, 10);
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * dd/mm/aaaa (ou YYYY-MM-DD) → ISO YYYY-MM-DD.
 * Retorna null se inválida.
 */
export function parseDateBr(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const check = new Date(year, month - 1, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Soma n meses a um YYYY-MM. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
