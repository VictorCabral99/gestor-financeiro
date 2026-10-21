import { Router } from "express";
import { z } from "zod";
import {
  clearLoginFailures,
  hasSession,
  isBridgeRole,
  loginLimited,
  noteLoginFailure,
  passwordHash,
  requestIsSecure,
  sendUnauthorized,
  sessionCookie,
  signSession,
  verifyPassword,
} from "../auth.js";
import { badRequest, HttpError, validateBody } from "../lib/http.js";
import { ensureProfileIdentity, listProfiles } from "../profiles.js";
import { applyChanges, readLog, type SyncChange } from "../sync/engine.js";
import { syncTable } from "../sync/catalog.js";

export const authRouter = Router();

const loginSchema = z.object({
  password: z.string().min(1, "Informe a senha"),
});

authRouter.post("/login", validateBody(loginSchema), (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "local";
  if (loginLimited(ip)) {
    res.status(429).json({ error: "Muitas tentativas. Espere alguns minutos." });
    return;
  }
  const hash = passwordHash();
  if (!hash || !verifyPassword(req.body.password, hash)) {
    noteLoginFailure(ip);
    res.status(401).json({ error: "Senha incorreta" });
    return;
  }
  clearLoginFailures(ip);
  res.setHeader("Set-Cookie", sessionCookie(signSession(), requestIsSecure(req)));
  res.json({ ok: true });
});

authRouter.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "gestor_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  if (!isBridgeRole()) {
    res.json({ mode: "local" });
    return;
  }
  if (!hasSession(req)) {
    sendUnauthorized(res);
    return;
  }
  res.json({ mode: "bridge" });
});

export function requireBridgeSession(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (!isBridgeRole()) {
    next();
    return;
  }
  const full = req.originalUrl.split("?")[0] ?? req.path;
  if (
    full === "/api/health" ||
    full === "/api/auth/login" ||
    req.path === "/health" ||
    req.path === "/auth/login"
  ) {
    next();
    return;
  }
  if (!hasSession(req)) {
    sendUnauthorized(res);
    return;
  }
  next();
}

export const syncRouter = Router();

const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  dbFile: z.string(),
  createdAt: z.string().optional(),
});

syncRouter.post("/hello", (req, res) => {
  const parsed = z.object({ profiles: z.array(profileSchema) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Perfis inválidos" });
    return;
  }
  for (const profile of parsed.data.profiles) {
    ensureProfileIdentity(profile);
  }
  res.json({ profiles: listProfiles() });
});

function parseChanges(body: unknown): SyncChange[] {
  const parsed = z
    .object({
      changes: z.array(
        z.object({
          table: z.string(),
          op: z.enum(["upsert", "delete"]),
          sync_id: z.string().min(1),
          lamport: z.number().int(),
          device_id: z.string(),
          sync_at: z.number().int(),
          payload: z.record(z.unknown()).optional(),
        }),
      ),
    })
    .safeParse(body);
  if (!parsed.success) {
    throw new Error("Mudanças inválidas");
  }
  return parsed.data.changes.map((change) => {
    syncTable(change.table);
    return {
      table: change.table,
      op: change.op,
      sync_id: change.sync_id,
      lamport: change.lamport,
      device_id: change.device_id,
      sync_at: change.sync_at,
      payload: change.payload ?? {},
    };
  });
}

syncRouter.post("/push", (req, res, next) => {
  try {
    const changes = parseChanges(req.body);
    res.json(applyChanges(changes));
  } catch (err) {
    if (err instanceof HttpError) {
      next(err);
      return;
    }
    badRequest(err instanceof Error ? err.message : "Mudanças inválidas");
  }
});

syncRouter.get("/pull", (req, res) => {
  const after = Number(req.query.after ?? 0);
  if (!Number.isFinite(after) || after < 0) {
    res.status(400).json({ error: "Cursor inválido" });
    return;
  }
  res.json(readLog(after));
});
