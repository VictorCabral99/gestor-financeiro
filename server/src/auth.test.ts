import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gestor-auth-"));
process.env.GESTOR_DATA_DIR = tempDir;
delete process.env.GESTOR_PASSWORD;
delete process.env.GESTOR_ROLE;
delete process.env.GESTOR_SESSION_SECRET;

const { hashPassword, listenBlockReason, sessionValid, signSession, verifyPassword } = await import(
  "./auth.js"
);

describe("conta", () => {
  it("confere a senha e recusa outra", () => {
    const stored = hashPassword("segredo-local");
    assert.equal(verifyPassword("segredo-local", stored), true);
    assert.equal(verifyPassword("outra", stored), false);
  });

  it("assinatura da sessão vale trinta dias e não aceita token alterado", () => {
    const token = signSession(1_000);
    assert.equal(sessionValid(token, 1_000 + 60_000), true);
    assert.equal(sessionValid(token, 1_000 + 40 * 24 * 60 * 60 * 1000), false);
    assert.equal(sessionValid(`${token}x`, 1_000 + 60_000), false);
  });

  it("recusa escutar fora de localhost sem senha", () => {
    assert.equal(listenBlockReason("127.0.0.1"), null);
    assert.ok(listenBlockReason("0.0.0.0"));
    process.env.GESTOR_ROLE = "bridge";
    assert.ok(listenBlockReason("127.0.0.1"));
    process.env.GESTOR_PASSWORD = "uma-senha";
    assert.equal(listenBlockReason("0.0.0.0"), null);
    delete process.env.GESTOR_PASSWORD;
    delete process.env.GESTOR_ROLE;
  });
});
