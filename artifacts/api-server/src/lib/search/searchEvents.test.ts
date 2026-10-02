import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameSearch, normaliseSearch, SAME_SEARCH_WINDOW_MS } from "./searchEvents";

test("typing further, trimming back or repeating is the same search", () => {
  assert.equal(isSameSearch("parac", "paracetamol", 1_500), true);
  assert.equal(isSameSearch("paracetamol", "paracet", 3_000), true);
  assert.equal(isSameSearch("Paracetamol ", "paracetamol", 800), true);
});

test("a different medicine, or the same one much later, is a new search", () => {
  assert.equal(isSameSearch("paracetamol", "amoxicillin", 2_000), false);
  assert.equal(isSameSearch("paracetamol", "paracetamol", SAME_SEARCH_WINDOW_MS + 1), false);
  assert.equal(isSameSearch("", "paracetamol", 1_000), false);
});

test("searches are stored in one spelling", () => {
  assert.equal(normaliseSearch("  Vitamin   C "), "vitamin c");
});
