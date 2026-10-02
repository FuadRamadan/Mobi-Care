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
test("catalogue options are matched ignoring capitals", () => {
  assert.equal(catalogueAllowsValue(["tablet"], "Tablet"), true);
  assert.equal(catalogueAllowsValue(["Powder for Injection"], "powder for  injection"), true);
});
