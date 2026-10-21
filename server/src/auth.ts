import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { dataDir } from "./paths.js";

const COOKIE = "gestor_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

export function isBridgeRole(): boolean {
  return process.env.GESTOR_ROLE === "bridge";
}

function authPath(): string {
  return path.join(dataDir, "auth.json");
}

function secretPath(): string {
  return path.join(dataDir, "session.secret");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 32).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "base64url");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function passwordHash(): string | null {
  const file = authPath();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { passwordHash?: string };
    return raw.passwordHash || null;
  } catch {
    return null;
  }
}

/** Grava a senha da conta na primeira subida. Não troca se já existir. */
export function ensurePasswordHash() {
  if (passwordHash()) return;
  const password = process.env.GESTOR_PASSWORD;
  if (!password) return;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(authPath(), JSON.stringify({ passwordHash: hashPassword(password) }), "utf8");
}

export function listenBlockReason(host: string): string | null {
  const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (local && !isBridgeRole()) return null;
  if (!passwordHash() && !process.env.GESTOR_PASSWORD) {
    return "Gestor fora de localhost exige senha. Defina GESTOR_PASSWORD na primeira subida.";
  }
  return null;
}

function sessionSecret(): string {
  if (process.env.GESTOR_SESSION_SECRET) return process.env.GESTOR_SESSION_SECRET;
  if (fs.existsSync(secretPath())) return fs.readFileSync(secretPath(), "utf8").trim();
  const secret = randomBytes(32).toString("base64url");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(secretPath(), secret, "utf8");
  return secret;
}

export function signSession(now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ exp: now + MAX_AGE_SEC * 1000 })).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function sessionValid(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

export function readCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function hasSession(req: Request): boolean {
  return sessionValid(readCookie(req));
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SEC}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function requestIsSecure(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers["x-forwarded-proto"];
  return proto === "https" || (Array.isArray(proto) && proto.includes("https"));
}

const failures = new Map<string, { n: number; at: number }>();

export function loginLimited(ip: string, now = Date.now()): boolean {
  const row = failures.get(ip);
  if (!row || now - row.at > 10 * 60 * 1000) return false;
  return row.n >= 8;
}

export function noteLoginFailure(ip: string, now = Date.now()) {
  const row = failures.get(ip);
  if (!row || now - row.at > 10 * 60 * 1000) failures.set(ip, { n: 1, at: now });
  else failures.set(ip, { n: row.n + 1, at: row.at });
}

export function clearLoginFailures(ip: string) {
  failures.delete(ip);
}

export function sendUnauthorized(res: Response) {
  res.status(401).json({ error: "Sem sessão" });
}
