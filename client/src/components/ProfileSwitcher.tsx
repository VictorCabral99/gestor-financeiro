import { useEffect, useRef, useState, type FormEvent } from "react";
import { useProfiles } from "../lib/profiles";

export function ProfileSwitcher() {
  const { profiles, activeId, active, loading, create, switchTo, rename, remove } =
    useProfiles();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setError(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await create(newName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar perfil");
      setBusy(false);
    }
  }

  async function handleRename(id: string, current: string) {
    const name = window.prompt("Novo nome do perfil:", current);
    if (!name || name.trim() === current) return;
    setBusy(true);
    setError(null);
    try {
      await rename(id, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao renomear");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (profiles.length <= 1) return;
    const ok = window.confirm(
      `Apagar o perfil "${name}" e todos os dados dele? Isso não tem volta.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await remove(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao apagar");
      setBusy(false);
    }
  }

  return (
    <div className="profile-switcher" ref={rootRef}>
      <button
        type="button"
        className="profile-trigger"
        onClick={() => {
          setOpen((v) => !v);
          setCreating(false);
          setError(null);
        }}
        disabled={loading}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="profile-trigger-label">Perfil</span>
        <strong>{active?.name ?? "…"}</strong>
      </button>

      {open && (
        <div className="profile-menu" role="listbox">
          <ul className="profile-list">
            {profiles.map((p) => (
              <li key={p.id} className={p.id === activeId ? "is-active" : undefined}>
                <button
                  type="button"
                  className="profile-pick"
                  onClick={() => switchTo(p.id)}
                  disabled={busy || p.id === activeId}
                >
                  {p.name}
                </button>
                <div className="profile-actions">
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => void handleRename(p.id, p.name)}
                    disabled={busy}
                  >
                    Renomear
                  </button>
                  {profiles.length > 1 && (
                    <button
                      type="button"
                      className="linkish danger"
                      onClick={() => void handleDelete(p.id, p.name)}
                      disabled={busy}
                    >
                      Apagar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {creating ? (
            <form className="profile-create" onSubmit={(e) => void handleCreate(e)}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome da pessoa"
                maxLength={60}
                disabled={busy}
              />
              <div className="profile-create-actions">
                <button type="submit" disabled={busy || !newName.trim()}>
                  Criar
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                  disabled={busy}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="profile-add"
              onClick={() => setCreating(true)}
              disabled={busy}
            >
              + Novo perfil
            </button>
          )}

          {error && <p className="profile-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
