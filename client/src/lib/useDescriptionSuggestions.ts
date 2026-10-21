import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export type DescriptionKind = "expense" | "income";

export function useDescriptionSuggestions(kind: DescriptionKind) {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const reload = useCallback(async () => {
    try {
      const path =
        kind === "expense" ? "/expenses/descriptions" : "/incomes/descriptions";
      const list = await api.get<string[]>(path);
      setSuggestions(list);
    } catch {
      // silencioso: autocomplete é opcional
    }
  }, [kind]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remember = useCallback((description: string) => {
    const d = description.trim();
    if (!d) return;
    setSuggestions((prev) => {
      const without = prev.filter(
        (x) => x.localeCompare(d, "pt-BR", { sensitivity: "accent" }) !== 0,
      );
      return [d, ...without];
    });
  }, []);

  return { suggestions, remember, reload };
}
