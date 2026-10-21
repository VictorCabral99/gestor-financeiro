import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths.js";
import { listProfiles } from "../profiles.js";
import { runWithProfile } from "../db.js";
import {
  applyChanges,
  discardOutbox,
  exportAll,
  meta,
  readLog,
  setMeta,
  takePending,
  type SyncChange,
} from "./engine.js";

type BridgeConfig = { url: string; password: string };

const CHUNK = 200;

export function loadBridgeConfig(): BridgeConfig | null {
  const envUrl = process.env.GESTOR_BRIDGE_URL?.replace(/\/$/, "");
  const envPassword = process.env.GESTOR_BRIDGE_PASSWORD;
  if (envUrl && envPassword) return { url: envUrl, password: envPassword };
  const file = path.join(dataDir, "bridge.json");
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { url?: string; password?: string };
    if (!raw.url || !raw.password) return null;
    return { url: raw.url.replace(/\/$/, ""), password: raw.password };
  } catch {
    return null;
  }
}

function cookieFile(): string {
  return path.join(dataDir, "bridge-cookie.txt");
}

function readStoredCookie(): string | null {
  if (!fs.existsSync(cookieFile())) return null;
  const value = fs.readFileSync(cookieFile(), "utf8").trim();
  return value || null;
}

function storeCookie(cookie: string) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(cookieFile(), cookie, "utf8");
}

async function login(cfg: BridgeConfig): Promise<string> {
  const res = await fetch(`${cfg.url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: cfg.password }),
  });
  if (!res.ok) {
    throw new Error(`Login na conta falhou (${res.status})`);
  }
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = cookies.find((item) => item.startsWith("gestor_session=")) ?? res.headers.get("set-cookie");
  if (!raw) throw new Error("A conta não devolveu sessão");
  const cookie = raw.split(";")[0] ?? raw;
  storeCookie(cookie);
  return cookie;
}

async function bridgeFetch(cfg: BridgeConfig, cookie: string, pathName: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("cookie", cookie);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${cfg.url}${pathName}`, { ...init, headers });
  if (res.status === 401) {
    const fresh = await login(cfg);
    headers.set("cookie", fresh);
    const retry = await fetch(`${cfg.url}${pathName}`, { ...init, headers });
    if (!retry.ok) throw new Error(`Conta respondeu ${retry.status} em ${pathName}`);
    return retry;
  }
  if (!res.ok) throw new Error(`Conta respondeu ${res.status} em ${pathName}`);
  return res;
}

async function pushAll(cfg: BridgeConfig, cookie: string, profileId: string, changes: SyncChange[]) {
  const settled: { table: string; sync_id: string }[] = [];
  const winners: SyncChange[] = [];
  for (let i = 0; i < changes.length; i += CHUNK) {
    const slice = changes.slice(i, i + CHUNK);
    const res = await bridgeFetch(cfg, cookie, "/api/sync/push", {
      method: "POST",
      headers: { "x-profile-id": profileId },
      body: JSON.stringify({ changes: slice }),
    });
    const body = (await res.json()) as {
      settled?: { table: string; sync_id: string }[];
      winners?: SyncChange[];
    };
    settled.push(...(body.settled ?? []));
    winners.push(...(body.winners ?? []));
  }
  if (winners.length > 0) applyChanges(winners);
  return settled;
}

async function syncProfile(cfg: BridgeConfig, cookie: string, profileId: string) {
  await runWithProfile(profileId, async () => {
    if (meta("baseline_pushed") !== "1") {
      await pushAll(cfg, cookie, profileId, exportAll());
      setMeta("baseline_pushed", "1");
    }
    const pending = takePending();
    if (pending.changes.length > 0) {
      const settled = await pushAll(cfg, cookie, profileId, pending.changes);
      discardOutbox(pending.maxId, settled);
    }
    const cursor = Number(meta("bridge_cursor") ?? "0");
    const res = await bridgeFetch(
      cfg,
      cookie,
      `/api/sync/pull?after=${cursor}`,
      { headers: { "x-profile-id": profileId } },
    );
    const body = (await res.json()) as { upTo: number; changes: SyncChange[] };
    if (body.changes?.length) applyChanges(body.changes);
    if (Number.isFinite(body.upTo)) setMeta("bridge_cursor", String(body.upTo));
  });
}

/** Envia a caixa de saída e busca o que o celular gravou na conta. */
export async function syncWithBridge(): Promise<void> {
  if (process.env.GESTOR_ROLE === "bridge") return;
  const cfg = loadBridgeConfig();
  if (!cfg) return;
  const cookie = readStoredCookie() ?? (await login(cfg));
  const profiles = listProfiles();
  await bridgeFetch(cfg, cookie, "/api/sync/hello", {
    method: "POST",
    body: JSON.stringify({ profiles }),
  });
  for (const profile of profiles) {
    await syncProfile(cfg, readStoredCookie() ?? cookie, profile.id);
  }
}
