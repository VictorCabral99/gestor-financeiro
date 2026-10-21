import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Pasta de dados do server: server/data (ou GESTOR_DATA_DIR nos testes) */
export const dataDir = process.env.GESTOR_DATA_DIR
  ? path.resolve(process.env.GESTOR_DATA_DIR)
  : path.resolve(__dirname, "../data");

/** @deprecated Prefira db.filePath() — caminho legado do perfil padrão */
export const dbPath = path.join(dataDir, "gestor.db");
/** Pasta raiz de backups; cada perfil usa backups/<profileId>/ */
export const backupDir = path.join(dataDir, "backups");

function resolveSchemaPath(): string {
  const candidates = [
    path.join(__dirname, "schema.sql"),
    path.join(__dirname, "../src/schema.sql"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export const schemaPath = resolveSchemaPath();

/** Build do Vite: client/dist (relativo a server/src ou server/dist) */
export const clientDistDir = path.resolve(__dirname, "../../client/dist");
