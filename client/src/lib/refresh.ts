import { useEffect } from "react";

export const DATA_CHANGED = "gestor-changed";

export function notifyDataChanged() {
  window.dispatchEvent(new Event(DATA_CHANGED));
}

export function useDataRefresh(reload: () => void) {
  useEffect(() => {
    const onChange = () => reload();
    window.addEventListener(DATA_CHANGED, onChange);
    return () => window.removeEventListener(DATA_CHANGED, onChange);
  }, [reload]);
}
