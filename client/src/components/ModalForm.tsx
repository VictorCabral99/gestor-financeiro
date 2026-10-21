import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { formatDateBr, maskMoneyInput, parseDateBr } from "../lib/format";

type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "money"
    | "date"
    | "month"
    | "color"
    | "select"
    | "textarea";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  /** Sugestões de autocomplete (datalist). */
  suggestions?: string[];
  /** Ao “salvar e novo”, limpa este campo (default: amount e description). */
  clearOnContinue?: boolean;
};

type Props = {
  title: string;
  fields: Field[];
  submitLabel?: string;
  /** Se definido, mostra botão para salvar e continuar lançando. */
  continueLabel?: string;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  children?: ReactNode;
};

export function ModalForm({
  title,
  fields,
  submitLabel = "Salvar",
  continueLabel,
  onClose,
  onSubmit,
  children,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [carryDefaults, setCarryDefaults] = useState<Record<string, string>>(
    {},
  );

  function fieldDefault(f: Field): string | undefined {
    if (carryDefaults[f.name] !== undefined) return carryDefaults[f.name];
    return f.defaultValue;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as
      | HTMLButtonElement
      | null;
    const andNew = submitter?.value === "and-new";

    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};

    for (const f of fields) {
      const raw = String(fd.get(f.name) ?? "").trim();
      if (f.type === "date") {
        if (!raw) {
          values[f.name] = "";
          continue;
        }
        const parsed = parseDateBr(raw);
        if (!parsed) {
          setError(`${f.label}: use o formato dd/mm/aaaa`);
          return;
        }
        values[f.name] = parsed;
      } else {
        values[f.name] = raw;
      }
    }

    setBusy(true);
    setError(null);
    setJustSaved(false);
    try {
      await onSubmit(values);
      if (andNew) {
        const next: Record<string, string> = {};
        for (const f of fields) {
          const shouldClear =
            f.clearOnContinue === true ||
            (f.clearOnContinue === undefined &&
              (f.name === "amount" ||
                f.name === "description" ||
                f.type === "money"));
          if (shouldClear) {
            next[f.name] = "";
          } else if (f.type === "date") {
            // values já em ISO; o default do input formata de novo
            next[f.name] = values[f.name] ?? f.defaultValue ?? "";
          } else {
            next[f.name] = values[f.name] ?? "";
          }
        }
        setCarryDefaults(next);
        setFormKey((k) => k + 1);
        setJustSaved(true);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {justSaved && (
          <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
            Salvo. Pode registrar o próximo.
          </p>
        )}
        {error && <div className="error">{error}</div>}
        <form className="form" key={formKey} onSubmit={handleSubmit}>
          {fields.map((f) => (
            <div className="field" key={f.name}>
              <label htmlFor={f.name}>{f.label}</label>
              {f.type === "select" ? (
                <select
                  id={f.name}
                  name={f.name}
                  required={f.required}
                  defaultValue={fieldDefault(f) ?? ""}
                >
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  id={f.name}
                  name={f.name}
                  rows={3}
                  defaultValue={fieldDefault(f)}
                  placeholder={f.placeholder}
                />
              ) : (
                <>
                  <input
                    id={f.name}
                    name={f.name}
                    type={
                      f.type === "money" || f.type === "date"
                        ? "text"
                        : (f.type ?? "text")
                    }
                    list={
                      f.suggestions && f.suggestions.length > 0
                        ? `${f.name}-suggestions`
                        : undefined
                    }
                    inputMode={
                      f.type === "money" || f.type === "date"
                        ? "numeric"
                        : undefined
                    }
                    required={f.required}
                    defaultValue={
                      f.type === "date" && fieldDefault(f)
                        ? formatDateBr(fieldDefault(f))
                        : fieldDefault(f)
                    }
                    placeholder={
                      f.placeholder ??
                      (f.type === "money"
                        ? "0,00"
                        : f.type === "date"
                          ? "dd/mm/aaaa"
                          : undefined)
                    }
                    step={f.type === "number" ? "0.01" : undefined}
                    autoFocus={f.name === "description"}
                    autoComplete={f.suggestions ? "off" : undefined}
                    onInput={
                      f.type === "money"
                        ? (e) => {
                            e.currentTarget.value = maskMoneyInput(
                              e.currentTarget.value,
                            );
                          }
                        : undefined
                    }
                  />
                  {f.suggestions && f.suggestions.length > 0 && (
                    <datalist id={`${f.name}-suggestions`}>
                      {f.suggestions.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  )}
                </>
              )}
            </div>
          ))}
          {children}
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
              {busy ? "Salvando…" : submitLabel}
            </button>
            {continueLabel && (
              <button
                type="submit"
                className="btn"
                name="intent"
                value="and-new"
                disabled={busy}
              >
                {busy ? "Salvando…" : continueLabel}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
