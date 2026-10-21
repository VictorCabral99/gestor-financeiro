import type { Category } from "../types";

/** Ordena pais e coloca cada subcategoria logo abaixo do pai. */
export function sortCategoriesTree(categories: Category[]): Category[] {
  const parents = categories
    .filter((c) => !c.parent_id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const children = categories.filter((c) => c.parent_id);

  const result: Category[] = [];
  for (const parent of parents) {
    result.push(parent);
    const kids = children
      .filter((c) => c.parent_id === parent.id)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    result.push(...kids);
  }

  // Órfãs (pai arquivado/inexistente)
  const placed = new Set(result.map((c) => c.id));
  for (const c of categories) {
    if (!placed.has(c.id)) result.push(c);
  }
  return result;
}

export function categorySelectOptions(categories: Category[]) {
  return sortCategoriesTree(categories).map((c) => ({
    value: String(c.id),
    label: c.parent_id
      ? `↳ ${categories.find((p) => p.id === c.parent_id)?.name ?? ""} › ${c.name}`
      : c.name,
  }));
}
