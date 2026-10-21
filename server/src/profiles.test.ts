import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gestor-profiles-"));
process.env.GESTOR_DATA_DIR = tempDir;

const { db, runWithProfile, forEachProfile, evictProfile } = await import("./db.js");
const {
  createProfile,
  listProfiles,
  renameProfile,
  deleteProfile,
} = await import("./profiles.js");
const { syncMonths } = await import("./services/months.js");

describe("perfis", () => {
  after(() => {
    for (const p of listProfiles()) {
      try {
        evictProfile(p.id);
      } catch {
        // ignore
      }
    }
  });

  it("cria perfil padrão Victor apontando para gestor.db", () => {
    const profiles = listProfiles();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0]!.name, "Victor");
    assert.equal(profiles[0]!.dbFile, "gestor.db");
    assert.ok(fs.existsSync(path.join(tempDir, "gestor.db")));
  });

  it("cria segundo perfil com banco isolado", () => {
    const other = createProfile("Maria");
    assert.equal(other.name, "Maria");
    assert.match(other.dbFile, /^gestor-maria/);

    runWithProfile(other.id, () => {
      syncMonths();
      db.prepare(`INSERT INTO accounts (name, opening_balance) VALUES (?, ?)`).run(
        "Conta Maria",
        5000,
      );
    });

    const defaultId = listProfiles().find((p) => p.dbFile === "gestor.db")!.id;
    runWithProfile(defaultId, () => {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number };
      assert.equal(n.n, 0);
    });

    runWithProfile(other.id, () => {
      const row = db.prepare(`SELECT name FROM accounts`).get() as { name: string };
      assert.equal(row.name, "Conta Maria");
    });
  });

  it("renomeia e apaga perfil extra", () => {
    const renamed = renameProfile(
      listProfiles().find((p) => p.name === "Maria")!.id,
      "Ana",
    );
    assert.equal(renamed.name, "Ana");

    const before = listProfiles().length;
    evictProfile(renamed.id);
    deleteProfile(renamed.id);
    assert.equal(listProfiles().length, before - 1);
    assert.ok(!fs.existsSync(path.join(tempDir, renamed.dbFile)));
  });

  it("forEachProfile visita todos", () => {
    createProfile("Extra");
    const names: string[] = [];
    forEachProfile((p) => names.push(p.name));
    assert.ok(names.includes("Victor"));
    assert.ok(names.includes("Extra"));
  });
});
