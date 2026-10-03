import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryMapLink, orderReadyMessage } from "./hqNotifications.js";

const delivery = {
  patientName: "Fatmata Sesay",
  patientPhone: "+23276000001",
  fulfillmentType: "delivery" as const,
  deliveryAddress: "Blue gate opposite the mosque, Wilkinson Road",
  deliveryZoneName: "Central Freetown",
  deliveryLatitude: "8.484000",
  deliveryLongitude: "-13.234400",
};

test("a ready delivery tells HQ how to reach and find the patient", () => {
  const text = orderReadyMessage(delivery, "Lumley Pharmacy");
  assert.match(text, /Lumley Pharmacy is packed\. Assign a courier\./);
  assert.match(text, /Patient phone: \+23276000001/);
  assert.match(text, /Deliver to: Blue gate opposite the mosque, Wilkinson Road/);
  assert.match(text, /Zone: Central Freetown/);
  assert.match(text, /Map: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=8\.484,-13\.2344/);
});

test("a delivery without directions or a pin still says so plainly", () => {
  const text = orderReadyMessage(
    { ...delivery, deliveryAddress: "  ", deliveryZoneName: null, deliveryLatitude: null, deliveryLongitude: null },
    "Lumley Pharmacy",
  );
  assert.match(text, /Deliver to: no directions given/);
  assert.doesNotMatch(text, /Zone:|Map:/);
});

test("a collection order needs no courier details", () => {
  const text = orderReadyMessage({ ...delivery, fulfillmentType: "collection" }, "Lumley Pharmacy");
  assert.equal(text, "Fatmata Sesay's collection order at Lumley Pharmacy is ready.");
});

test("no map link for a missing or broken pin", () => {
  assert.equal(deliveryMapLink({ deliveryLatitude: null, deliveryLongitude: "1" }), null);
  assert.equal(deliveryMapLink({ deliveryLatitude: "abc", deliveryLongitude: "1" }), null);
});
