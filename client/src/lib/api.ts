const PROFILE_KEY = "gestor.profileId";
const CACHE_PREFIX = "gestor.cache:";
const QUEUE_KEY = "gestor.queue";

export class QueuedSyncError extends Error {
  constructor() {
    super("Na fila deste celular. Envia quando a internet voltar.");
    this.name = "QueuedSyncError";
  }
}

export type QueueItem = {
  id: string;
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  label: string;
  error?: string;
};

export function getStoredProfileId(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}

export function setStoredProfileId(id: string) {
  try {
    if (!id) localStorage.removeItem(PROFILE_KEY);
    else localStorage.setItem(PROFILE_KEY, id);
  } catch {
    // ignore
  }
}

export function peekCache<T>(path: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + path);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function remember(path: string, data: unknown) {
  try {
    const raw = JSON.stringify(data);
    if (raw.length > 1_500_000) return;
    localStorage.setItem(CACHE_PREFIX + path, raw);
  } catch {
    // cota cheia: a tela segue com a rede
  }
}

function readQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("gestor-queue"));
}

export function listQueue(): QueueItem[] {
  return readQueue();
}

function labelOf(method: string, path: string, body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.description === "string" && record.description.trim()) return record.description.trim();
    if (typeof record.name === "string" && record.name.trim()) return record.name.trim();
  }
  return `${method} ${path}`;
}

function enqueue(method: QueueItem["method"], path: string, body: unknown) {
  const items = readQueue();
  items.push({
    id: crypto.randomUUID(),
    method,
    path,
    body,
    label: labelOf(method, path, body),
  });
  writeQueue(items);
}

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

async function send<T>(
  path: string,
  method: string,
  body: unknown | undefined,
  replay: boolean,
): Promise<T> {
  if (!online() && method !== "GET") {
    if (!replay) enqueue(method as QueueItem["method"], path, body);
    throw new QueuedSyncError();
  }

  const profileId = getStoredProfileId();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(profileId ? { "X-Profile-Id": profileId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (method === "GET") {
      const cached = peekCache<T>(path);
      if (cached != null) return cached;
    } else if (!replay) {
      enqueue(method as QueueItem["method"], path, body);
      throw new QueuedSyncError();
    }
    throw err;
  }

  if (res.status === 401 && path !== "/auth/login") {
    window.dispatchEvent(new Event("gestor-unauthorized"));
    throw new Error("Sessão expirada");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  }
  if (method === "GET") remember(path, data);
  return data as T;
}

let flushing = false;

export async function flushQueue() {
  if (flushing || !online()) return;
  flushing = true;
  let sent = 0;
  try {
    for (const item of readQueue()) {
      try {
        await send(item.path, item.method, item.body, true);
        writeQueue(readQueue().filter((row) => row.id !== item.id));
        sent += 1;
      } catch (err) {
        if (!online() || err instanceof TypeError) break;
        const message = err instanceof Error ? err.message : "Falhou ao enviar";
        writeQueue(
          readQueue().map((row) => (row.id === item.id ? { ...row, error: message } : row)),
        );
        break;
      }
    }
  } finally {
    flushing = false;
  }
  if (sent > 0 && readQueue().length === 0) {
    window.dispatchEvent(new Event("gestor-synced"));
  }
}

export const api = {
  get: <T>(path: string) => send<T>(path, "GET", undefined, false),
  post: <T>(path: string, body?: unknown) => send<T>(path, "POST", body ?? {}, false),
  patch: <T>(path: string, body: unknown) => send<T>(path, "PATCH", body, false),
  delete: <T = void>(path: string) => send<T>(path, "DELETE", undefined, false),
};
