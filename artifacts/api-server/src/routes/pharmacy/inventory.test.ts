import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogueAllowsValue } from "./inventory";

test("empty catalogue options accept a pharmacy-supplied listing value", () => {
  assert.equal(catalogueAllowsValue([], "500mg"), true);
  assert.equal(catalogueAllowsValue([], "tablet"), true);
});

test("configured catalogue options remain an allowlist", () => {
  assert.equal(catalogueAllowsValue(["500mg", "1g"], "500mg"), true);
  assert.equal(catalogueAllowsValue(["500mg", "1g"], "250mg"), false);
});