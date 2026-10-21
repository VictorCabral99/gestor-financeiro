import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "./paths.js";
import { badRequest, notFound } from "./lib/http.js";

export type Profile = {
  id: string;
  name: string;
  dbFile: string;
  createdAt: string;
};

type ProfilesStore = {
  profiles: Profile[];
};

const STORE_FILE = "profiles.json";
const DEFAULT_ID = "default";
const DEFAULT_DB = "gestor.db";

function storePath(): string {
  return path.join(dataDir, STORE_FILE);
}

function readStore(): ProfilesStore {
  const file = storePath();
  if (!fs.existsSync(file)) {
    return { profiles: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as ProfilesStore;
    if (!Array.isArray(raw.profiles)) return { profiles: [] };
    return raw;
  } catch {
    return { profiles: [] };
  }
}

function writeStore(store: ProfilesStore) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), "utf8");
}

function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return base || "perfil";
}

/** Garante o perfil padrão apontando para o gestor.db existente (dados atuais). */
export function ensureProfiles(): Profile[] {
  const store = readStore();
  if (store.profiles.length === 0) {
    const now = new Date().toISOString();
    store.profiles = [
      {
        id: DEFAULT_ID,
        name: "Victor",
        dbFile: DEFAULT_DB,
        createdAt: now,
      },
    ];
    writeStore(store);
  }
  return store.profiles;
}

export function listProfiles(): Profile[] {
  return ensureProfiles();
}

export function getProfile(id: string): Profile {
  const profile = ensureProfiles().find((p) => p.id === id);
  if (!profile) notFound("Perfil");
  return profile;
}

export function resolveProfileId(raw: string | undefined | null): string {
  const profiles = ensureProfiles();
  if (raw && profiles.some((p) => p.id === raw)) return raw;
  return profiles[0]!.id;
}

export function profileDbPath(profile: Profile): string {
  const base = path.basename(profile.dbFile);
  if (base !== profile.dbFile || base.includes("..") || !base.endsWith(".db")) {
    badRequest("Arquivo de banco do perfil inválido");
  }
  return path.join(dataDir, base);
}

export function createProfile(name: string): Profile {
  const trimmed = name.trim();
  if (!trimmed) badRequest("Informe o nome do perfil");
  if (trimmed.length > 60) badRequest("Nome do perfil muito longo");

  const profiles = ensureProfiles();

  if (profiles.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    badRequest("Já existe um perfil com esse nome");
  }

  const id = randomUUID().slice(0, 8);
  let dbFile = `gestor-${slugify(trimmed)}.db`;
  const used = new Set(profiles.map((p) => p.dbFile));
  if (used.has(dbFile) || dbFile === DEFAULT_DB) {
    dbFile = `gestor-${slugify(trimmed)}-${id}.db`;
  }

  const profile: Profile = {
    id,
    name: trimmed,
    dbFile,
    createdAt: new Date().toISOString(),
  };
  writeStore({ profiles: [...profiles, profile] });
  return profile;
}

export function renameProfile(id: string, name: string): Profile {
  const trimmed = name.trim();
  if (!trimmed) badRequest("Informe o nome do perfil");
  if (trimmed.length > 60) badRequest("Nome do perfil muito longo");

  const store = readStore();
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) notFound("Perfil");

  if (
    store.profiles.some(
      (p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase(),
    )
  ) {
    badRequest("Já existe um perfil com esse nome");
  }

  profile.name = trimmed;
  writeStore(store);
  return profile;
}

export function deleteProfile(id: string): { ok: true; deleted: string } {
  const store = readStore();
  if (store.profiles.length <= 1) {
    badRequest("Não é possível apagar o único perfil");
  }
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx < 0) notFound("Perfil");

  const [removed] = store.profiles.splice(idx, 1);
  writeStore(store);

  const dbFile = path.join(dataDir, path.basename(removed!.dbFile));
  for (const suffix of ["", "-wal", "-shm"] as const) {
    const full = dbFile + suffix;
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }

  const backups = path.join(dataDir, "backups", removed!.id);
  if (fs.existsSync(backups)) {
    fs.rmSync(backups, { recursive: true, force: true });
  }

  return { ok: true, deleted: removed!.id };
}

/** Cria o perfil na ponte com o mesmo id do computador, se ainda não existir. */
export function ensureProfileIdentity(input: {
  id: string;
  name: string;
  dbFile: string;
  createdAt?: string;
}): Profile {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(input.id)) badRequest("Perfil inválido");
  const base = path.basename(input.dbFile);
  if (base !== input.dbFile || base.includes("..") || !base.endsWith(".db")) {
    badRequest("Arquivo de banco do perfil inválido");
  }
  const store = readStore();
  const existing = store.profiles.find((p) => p.id === input.id);
  if (existing) return existing;
  const profile: Profile = {
    id: input.id,
    name: input.name.trim().slice(0, 60) || "Perfil",
    dbFile: base,
    createdAt: input.createdAt || new Date().toISOString(),
  };
  writeStore({ profiles: [...store.profiles, profile] });
  return profile;
}

export function profileBackupDir(profileId: string): string {
  return path.join(dataDir, "backups", profileId);
}
