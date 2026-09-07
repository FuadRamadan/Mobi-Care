import assert from "node:assert/strict";
import test from "node:test";
import { mobileMoneyLines } from "./mobileMoney.js";

test("both named lines are returned, Orange first", () => {
  assert.deepEqual(
    mobileMoneyLines({
      orangeMoneyNumber: "+23276111222",
      afriMoneyNumber: "+23288333444",
    }),
    [
      { provider: "Orange Money", number: "+23276111222" },
      { provider: "AfriMoney", number: "+23288333444" },
    ],
  );
});

test("a pharmacy with only AfriMoney publishes only that", () => {
  assert.deepEqual(
    mobileMoneyLines({ afriMoneyNumber: "+23288333444" }),
    [{ provider: "AfriMoney", number: "+23288333444" }],
  );
});

test("a legacy row stays payable, with its provider made readable", () => {
  // The migration cannot classify a provider it does not recognise, so the
  // number must still reach the patient rather than vanishing.
  assert.deepEqual(
    mobileMoneyLines({
      mobileMoneyNumber: "+23276111222",
      mobileMoneyProvider: "orange_money",
    }),
    [{ provider: "Orange Money", number: "+23276111222" }],
  );
  assert.deepEqual(
    mobileMoneyLines({
      mobileMoneyNumber: "+23277000111",
      mobileMoneyProvider: "qmoney",
    }),
    [{ provider: "Qmoney", number: "+23277000111" }],
  );
  assert.deepEqual(
    mobileMoneyLines({ mobileMoneyNumber: "+23277000111" }),
    [{ provider: "Mobile money", number: "+23277000111" }],
  );
});

test("the legacy number is dropped once real lines exist", () => {
  // Otherwise the patient is offered a stale number alongside a current one and
  // has no way to tell which the pharmacy actually watches.
  assert.deepEqual(
    mobileMoneyLines({
      orangeMoneyNumber: "+23276111222",
      mobileMoneyNumber: "+23299888777",
      mobileMoneyProvider: "orange_money",
    }),
    [{ provider: "Orange Money", number: "+23276111222" }],
  );
});

test("blank and whitespace-only values are not lines", () => {
  assert.deepEqual(mobileMoneyLines({}), []);
  assert.deepEqual(
    mobileMoneyLines({ orangeMoneyNumber: "   ", afriMoneyNumber: "" }),
    [],
  );
  assert.deepEqual(mobileMoneyLines({ orangeMoneyNumber: null }), []);
});

test("numbers are trimmed but never reformatted", () => {
  // Sierra Leonean numbers are written several ways. Storing what the operator
  // typed is safer than normalising it into something nobody recognises.
  assert.deepEqual(
    mobileMoneyLines({ orangeMoneyNumber: "  076 111 222  " }),
    [{ provider: "Orange Money", number: "076 111 222" }],
  );
});
