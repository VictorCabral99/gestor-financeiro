type Props = {
  description: string;
  onClose: () => void;
  onConfirm: (scope: "one" | "forward" | "all") => Promise<void>;
};

export function DeleteFixedModal({ description, onClose, onConfirm }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Excluir fixo</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          <strong>{description}</strong> — o que deseja apagar?
        </p>
        <div className="stack">
          <button
            type="button"
            className="btn"
            onClick={() => void onConfirm("one")}
          >
            Só este mês
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void onConfirm("forward")}
          >
            Este e os próximos
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void onConfirm("all")}
          >
            Todos (passados e futuros)
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
