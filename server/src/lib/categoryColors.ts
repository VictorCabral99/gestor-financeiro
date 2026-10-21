/** Paleta distinta para categorias (gráficos / listagens). */
export const CATEGORY_PALETTE = [
  "#0b6b52",
  "#c45c26",
  "#1f4e79",
  "#8a3a2a",
  "#b8860b",
  "#5b2c6f",
  "#1a7a6d",
  "#b03a5b",
  "#2e86ab",
  "#6c3483",
  "#117a65",
  "#d35400",
  "#1e8449",
  "#922b21",
  "#1a5276",
  "#9a7d0a",
  "#4a235a",
  "#0e6655",
  "#a04000",
  "#2874a6",
  "#6e2c00",
  "#145a32",
  "#7b241c",
  "#154360",
  "#1abc9c",
  "#e67e22",
  "#3498db",
  "#9b59b6",
  "#16a085",
  "#e74c3c",
] as const;

function normalizeHex(color: string): string {
  return color.trim().toLowerCase();
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Escolhe uma cor da paleta ainda não usada (aleatória entre as livres). */
export function pickCategoryColor(usedColors: string[]): string {
  const used = new Set(usedColors.map(normalizeHex));
  const available = CATEGORY_PALETTE.filter((c) => !used.has(normalizeHex(c)));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)]!;
  }

  for (let i = 0; i < 360; i++) {
    const hue = Math.round((i * 137.508) % 360);
    const hex = hslToHex(hue, 58, 40);
    if (!used.has(hex)) return hex;
  }
  return CATEGORY_PALETTE[Math.floor(Math.random() * CATEGORY_PALETTE.length)]!;
}

/**
 * Mantém a primeira ocorrência de cada cor; duplicatas recebem cor nova.
 * Retorna só as linhas que precisam de UPDATE.
 */
export function dedupeCategoryColors(
  categories: { id: number; color: string }[],
): { id: number; color: string }[] {
  const used = new Set<string>();
  const updates: { id: number; color: string }[] = [];

  for (const cat of categories) {
    const key = normalizeHex(cat.color || "");
    if (key && !used.has(key)) {
      used.add(key);
      continue;
    }
    const next = pickCategoryColor([...used]);
    used.add(normalizeHex(next));
    updates.push({ id: cat.id, color: next });
  }

  return updates;
}
