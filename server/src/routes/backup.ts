import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db.js";
import { badRequest, notFound } from "../lib/http.js";
import { profileBackupDir } from "../profiles.js";

export const backupRouter = Router();

function currentBackupDir(): string {
  return profileBackupDir(db.profileId());
}

function listBackupFiles() {
  const dir = currentBackupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((filename) => {
      const full = path.join(dir, filename);
      const stat = fs.statSync(full);
      return { filename, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function safeBackupPath(filename: string): string {
  const base = path.basename(filename);
  if (base !== filename || !base.endsWith(".db") || base.includes("..")) {
    badRequest("Nome de backup inválido");
  }
  const full = path.join(currentBackupDir(), base);
  if (!fs.existsSync(full)) notFound("Backup");
  return full;
}

backupRouter.post("/", (_req, res) => {
  const dbFile = db.filePath();
  if (!fs.existsSync(dbFile)) badRequest("Banco não encontrado");
  const dir = currentBackupDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Consolida WAL no arquivo principal antes de copiar
  db.exec("PRAGMA wal_checkpoint(FULL)");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `gestor-${stamp}.db`);
  fs.copyFileSync(dbFile, dest);

  res.status(201).json({
    ok: true,
    filename: path.basename(dest),
  });
});

backupRouter.get("/", (_req, res) => {
  res.json(listBackupFiles());
});

backupRouter.post("/restore", (req, res) => {
  const filename = String(req.body?.filename ?? "");
  if (!filename) badRequest("Informe o filename do backup");

  const source = safeBackupPath(filename);
  const dir = currentBackupDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const dbFile = db.filePath();

  // Segurança: snapshot do estado atual antes de sobrescrever
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safety = path.join(dir, `pre-restore-${stamp}.db`);

  db.close();
  try {
    if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, safety);
    for (const suffix of ["-wal", "-shm"] as const) {
      const side = dbFile + suffix;
      if (fs.existsSync(side)) fs.unlinkSync(side);
    }
    fs.copyFileSync(source, dbFile);
  } catch (err) {
    try {
      db.reopen();
    } catch {
      // ignore
    }
    throw err;
  }

  db.reopen();

  res.json({
    ok: true,
    restored: path.basename(source),
    safety_backup: path.basename(safety),
  });
});
