import { sendSms } from "../src/lib/sms.js";

const recipient = process.env.ORANGE_SMS_TEST_RECIPIENT;
if (!recipient) {
  throw new Error("ORANGE_SMS_TEST_RECIPIENT is required for the controlled verification");
}

const result = await sendSms(
  recipient,
  "MobiCare Orange SMS configuration verified successfully.",
);
console.log("Orange SMS verification accepted", {
  deliveryId: result.deliveryId,
  providerMessageId: result.providerMessageId,
});