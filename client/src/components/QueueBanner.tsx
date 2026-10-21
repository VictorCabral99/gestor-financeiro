import { useEffect, useState } from "react";
import { flushQueue, listQueue, type QueueItem } from "../lib/api";

export function QueueBanner() {
  const [items, setItems] = useState<QueueItem[]>(() => listQueue());

  useEffect(() => {
    const refresh = () => setItems(listQueue());
    window.addEventListener("gestor-queue", refresh);
    const onOnline = () => {
      void flushQueue();
    };
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => {
      void flushQueue();
    }, 15_000);
    void flushQueue();
    return () => {
      window.removeEventListener("gestor-queue", refresh);
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="queue-banner" aria-live="polite">
      <div className="queue-banner-head">
        <strong>
          {items.length} {items.length === 1 ? "lançamento na fila" : "lançamentos na fila"}
        </strong>
        <button type="button" className="btn btn-sm" onClick={() => void flushQueue()}>
          Enviar agora
        </button>
      </div>
      <ul>
        {items.slice(0, 6).map((item) => (
          <li key={item.id}>
            <span>{item.label}</span>
            {item.error ? <small>{item.error}</small> : <small>Ainda neste celular</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}
