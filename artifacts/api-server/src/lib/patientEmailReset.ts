import { createHash, createHmac } from "node:crypto";

export function normalizeRecoveryEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function emailRecoveryHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function emailOtpHash(requestId: string, otp: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return createHmac("sha256", secret).update(`${requestId}:${otp}`).digest("hex");
}

export function resetTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function encodePasswordResetEmail(
  recipient: string,
  otp: string,
  expiresInMinutes: number,
): string {
  const message = [
    "From: MobiCare <mobicaresl00@gmail.com>",
    `To: ${recipient}`,
    "Subject: Your MobiCare Password Reset Code",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    "Your MobiCare Password Reset Code",
    "",
    `Your verification code is: ${otp}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    "",
    "If you did not request a password reset, you can safely ignore this email.",
    "Do not share this code with anyone.",
    "",
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}