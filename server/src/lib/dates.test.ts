import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMonths,
  clampDayInMonth,
  isValidDate,
  isValidMonth,
  monthsBetween,
} from "./dates.js";

describe("dates", () => {
  it("addMonths atravessa ano", () => {
    assert.equal(addMonths("2025-11", 2), "2026-01");
    assert.equal(addMonths("2026-03", -1), "2026-02");
  });

  it("monthsBetween conta diferença em meses", () => {
    assert.equal(monthsBetween("2026-01", "2026-01"), 0);
    assert.equal(monthsBetween("2026-01", "2026-04"), 3);
  });

  it("clampDayInMonth limita 29/30/31 em fevereiro", () => {
    assert.equal(clampDayInMonth("2026-02", 31), "2026-02-28");
    assert.equal(clampDayInMonth("2024-02", 31), "2024-02-29");
    assert.equal(clampDayInMonth("2026-04", 31), "2026-04-30");
    assert.equal(clampDayInMonth("2026-01", 15), "2026-01-15");
  });

  it("valida mês e data ISO", () => {
    assert.equal(isValidMonth("2026-07"), true);
    assert.equal(isValidMonth("2026-13"), false);
    assert.equal(isValidDate("2026-02-28"), true);
    assert.equal(isValidDate("2026-02-30"), false);
  });
});
