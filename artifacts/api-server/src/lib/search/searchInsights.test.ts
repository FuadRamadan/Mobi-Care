import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, closestMedicine, editDistance, type CatalogueName } from "./notFound.js";
import { areaFrom, districtAt, districtFromAddress, type NamedArea } from "./searchArea.js";
import { assembleReport, trendOf, trendWeeks, weekStart } from "./notFoundReport.js";

const catalogue: CatalogueName[] = [
  { id: "d-amox", name: "Amoxicillin", genericName: "Amoxicillin" },
  { id: "d-para", name: "Paracetamol", genericName: "Paracetamol" },
  { id: "d-al", name: "Artemether/Lumefantrine", genericName: "Artemether/Lumefantrine" },
];

// ── Spelling ────────────────────────────────────────────────────────────────

test("edit distance counts a swap of two letters as one change", () => {
  assert.equal(editDistance("paracetamol", "paracetamol"), 0);
  assert.equal(editDistance("paracetmol", "paracetamol"), 1);
  assert.equal(editDistance("parcaetamol", "paracetamol"), 1);
});

test("common misspellings find the medicine meant; unrelated words do not", () => {
  assert.equal(closestMedicine("amoxicilin", catalogue)?.id, "d-amox");
  assert.equal(closestMedicine("paracetmol", catalogue)?.id, "d-para");
  assert.equal(closestMedicine("artemeter", catalogue)?.id, "d-al");
  assert.equal(closestMedicine("insulin", catalogue), null);
  assert.equal(closestMedicine("am", catalogue), null, "too short to guess");
});

// ── Why not found ───────────────────────────────────────────────────────────

const amox = catalogue[0]!;

test("a result someone has in stock is not 'not found'", () => {
  const returned = [{ drugId: "d-para", name: "Paracetamol", offers: [{ inStock: false }, { inStock: true }] }];
  assert.equal(classify({ returned, known: null, closest: null }), null);
});

test("listed but out of stock at every pharmacy", () => {
  const returned = [{ drugId: "d-para", name: "Paracetamol", offers: [{ inStock: false }] }];
  assert.deepEqual(classify({ returned, known: null, closest: null }), { reason: "out_of_stock", drugId: "d-para", drugName: "Paracetamol" });
});

test("a known medicine no pharmacy offers, and one in stock elsewhere", () => {
  assert.equal(classify({ returned: [], known: { drug: amox, listed: false, inStock: false }, closest: null })?.reason, "not_listed");
  assert.equal(classify({ returned: [], known: { drug: amox, listed: true, inStock: false }, closest: null })?.reason, "out_of_stock");
  // In stock somewhere: the search was narrowed, the medicine is not missing.
  assert.equal(classify({ returned: [], known: { drug: amox, listed: true, inStock: true }, closest: null }), null);
});

test("a misspelling of an available medicine is not a medicine not found", () => {
  // The patient is offered "Did you mean Amoxicillin?"; nothing is missing.
  assert.equal(classify({ returned: [], known: null, closest: { drug: amox, listed: true, inStock: true } }), null);
  // Misspelled AND unavailable is a real gap, counted under the real name.
  assert.deepEqual(classify({ returned: [], known: null, closest: { drug: amox, listed: true, inStock: false } }), {
    reason: "out_of_stock",
    drugId: "d-amox",
    drugName: "Amoxicillin",
  });
  assert.equal(classify({ returned: [], known: null, closest: { drug: amox, listed: false, inStock: false } })?.reason, "not_listed");
});

test("nothing like it anywhere: not in the catalogue", () => {
  assert.deepEqual(classify({ returned: [], known: null, closest: null }), { reason: "not_in_catalogue", drugId: null, drugName: null });
});

// ── Areas ───────────────────────────────────────────────────────────────────

const centralFreetown: NamedArea = {
  name: "Central Freetown",
  boundary: { type: "Polygon", coordinates: [[[-13.245, 8.43], [-13.215, 8.43], [-13.215, 8.5], [-13.245, 8.5], [-13.245, 8.43]]] },
};

test("districts from a point: Freetown, Bo, Kenema; nothing at sea", () => {
  assert.equal(districtAt([-13.234, 8.484]), "Western Area Urban (Freetown)");
  assert.equal(districtAt([-11.738, 7.964]), "Bo");
  assert.equal(districtAt([-11.19, 7.876]), "Kenema");
  assert.equal(districtAt([-14.5, 8.0]), null);
});

test("districts from an address: whole words only", () => {
  assert.equal(districtFromAddress("12 Main Road, Bo"), "Bo");
  assert.equal(districtFromAddress("Lumley, Freetown"), "Western Area Urban (Freetown)");
  assert.equal(districtFromAddress("Boston Street"), null, "Bo inside a longer word is not Bo");
  assert.equal(districtFromAddress(""), null);
});

test("area: the phone's location first, as a zone with its district", () => {
  const area = areaFrom({ location: [-13.234, 8.484], deliveryPin: [-11.738, 7.964], address: "Kenema", zones: [centralFreetown] });
  assert.deepEqual(area, { zone: "Central Freetown", district: "Western Area Urban (Freetown)", source: "location" });
});

test("area: outside every zone, the district; then the delivery pin; then the address", () => {
  assert.deepEqual(areaFrom({ location: [-11.738, 7.964], deliveryPin: null, address: null, zones: [centralFreetown] }), { zone: null, district: "Bo", source: "location" });
  assert.deepEqual(areaFrom({ location: null, deliveryPin: [-13.234, 8.484], address: null, zones: [centralFreetown] }), { zone: "Central Freetown", district: "Western Area Urban (Freetown)", source: "delivery_pin" });
  assert.deepEqual(areaFrom({ location: null, deliveryPin: null, address: "Kenema town", zones: [] }), { zone: null, district: "Kenema", source: "address" });
  assert.deepEqual(areaFrom({ location: [-14.5, 8.0], deliveryPin: null, address: null, zones: [] }), { zone: null, district: "Unknown", source: "unknown" });
});

// ── The report ──────────────────────────────────────────────────────────────

test("weeks start on Monday and the trend covers eight of them", () => {
  assert.equal(weekStart(new Date("2026-10-11T12:00:00Z")), "2026-10-05"); // a Sunday
  assert.equal(weekStart(new Date("2026-10-12T00:00:00Z")), "2026-10-12"); // a Monday
  const weeks = trendWeeks(new Date("2026-10-11T23:59:59Z"));
  assert.equal(weeks.length, 8);
  assert.equal(weeks[7], "2026-10-05");
  assert.equal(weeks[0], "2026-08-17");
});

test("trend: rising, falling, steady, new", () => {
  assert.equal(trendOf([2, 2, 2, 2, 2, 2, 2, 6]), "rising");
  assert.equal(trendOf([6, 6, 6, 6, 6, 6, 6, 2]), "falling");
  assert.equal(trendOf([3, 3, 3, 3, 3, 3, 3, 3]), "steady");
  assert.equal(trendOf([0, 0, 0, 0, 0, 0, 0, 4]), "new");
  assert.equal(trendOf([0, 0, 0, 0, 0, 0, 1, 2]), "steady", "too few searches to call it rising");
});

const reportInput = (shareable: boolean) => ({
  start: new Date("2026-10-01T00:00:00Z"),
  end: new Date("2026-10-11T23:59:59Z"),
  shareable,
  totals: { searches: 100, unavailable: 30, people: 12 },
  medicines: [
    { medicine: "Amoxicillin", in_catalogue: true, searches: 20, people: 8, first_seen: "2026-10-02T09:00:00Z", last_seen: "2026-10-11T10:00:00Z" },
    { medicine: "Insulin", in_catalogue: false, searches: 3, people: 2, first_seen: "2026-10-05T09:00:00Z", last_seen: "2026-10-06T10:00:00Z" },
  ],
  reasons: [
    { medicine: "Amoxicillin", reason: "out_of_stock", searches: 15 },
    { medicine: "Amoxicillin", reason: "misspelled", searches: 5 },
    { medicine: "Insulin", reason: "not_in_catalogue", searches: 3 },
  ],
  areas: [
    { medicine: "Amoxicillin", area: "East End", searches: 14, people: 6 },
    { medicine: "Amoxicillin", area: "Bo", searches: 6, people: 2 },
    { medicine: "Insulin", area: "Central Freetown", searches: 3, people: 2 },
  ],
  typed: [
    { medicine: "Amoxicillin", typed: "amoxicillin", searches: 15 },
    { medicine: "Amoxicillin", typed: "amoxicilin", searches: 5 },
  ],
  weekly: [
    { medicine: "Amoxicillin", week: "2026-09-28", searches: 4 },
    { medicine: "Amoxicillin", week: "2026-10-05", searches: 16 },
  ],
});

test("HQ report: every medicine and area, the main reason, the spellings typed", () => {
  const report = assembleReport(reportInput(false));
  assert.deepEqual(report.rows.map((r) => r.medicine), ["Amoxicillin", "Insulin"]);
  const amoxRow = report.rows[0]!;
  assert.equal(amoxRow.reason, "out_of_stock");
  assert.deepEqual(amoxRow.areas.map((a) => a.area), ["East End", "Bo"]);
  assert.deepEqual(amoxRow.typed, ["amoxicillin", "amoxicilin"]);
  assert.deepEqual(amoxRow.weekly.slice(-2).map((w) => w.searches), [4, 16]);
  assert.equal(amoxRow.trend, "rising");
  assert.equal(report.summary.unavailableSearches, 30);
});

test("shareable report: nothing under 5 people, and never what was typed", () => {
  const report = assembleReport(reportInput(true));
  assert.deepEqual(report.rows.map((r) => r.medicine), ["Amoxicillin"], "Insulin (2 people) is left out");
  assert.deepEqual(report.rows[0]!.areas.map((a) => a.area), ["East End"], "Bo (2 people) is left out");
  assert.deepEqual(report.rows[0]!.typed, []);
  assert.equal(report.summary.unavailableSearches, 20, "counts only what is shown");
  assert.equal(report.minimumPeople, 5);
});

// ── HQ alerts ───────────────────────────────────────────────────────────────

import { MIN_PEOPLE, risingMedicines, type MedicineWindow } from "./medicineAlerts.js";

const window = (over: Partial<MedicineWindow>): MedicineWindow => ({
  medicine: "Amlodipine",
  recentSearches: 12,
  recentPeople: 10,
  earlierSearches: 9, // 3 a week
  reason: "out_of_stock",
  areas: ["East End", "Central Freetown"],
  ...over,
});

test("alert: a sharp rise seen by enough people", () => {
  const [alert] = risingMedicines([window({})]);
  assert.equal(alert?.title, "Hard to find: Amlodipine");
  assert.match(alert!.body, /10 people could not get Amlodipine in the last 7 days \(12 searches\)/);
  assert.match(alert!.body, /About 3 a week in the 3 weeks before/);
  assert.match(alert!.body, /Mostly East End, Central Freetown/);
  assert.match(alert!.body, /Reason: Out of stock everywhere\./);
});

test("alert: something new, with nothing before it", () => {
  const [alert] = risingMedicines([window({ medicine: "Insulin", earlierSearches: 0, reason: "not_in_catalogue", recentPeople: 6 })]);
  assert.match(alert!.body, /None in the 3 weeks before/);
});

test("no alert: too few people, no real rise, or only a misspelling", () => {
  assert.deepEqual(risingMedicines([window({ recentPeople: MIN_PEOPLE - 1 })]), []);
  assert.deepEqual(risingMedicines([window({ recentSearches: 5, earlierSearches: 12 })]), [], "5 against 4 a week is not a doubling");
  assert.deepEqual(risingMedicines([window({ reason: "misspelled" })]), []);
});

test("alerts are ordered by how many people are affected", () => {
  const alerts = risingMedicines([window({ medicine: "A", recentPeople: 6 }), window({ medicine: "B", recentPeople: 20 })]);
  assert.deepEqual(alerts.map((a) => a.medicine), ["B", "A"]);
});
