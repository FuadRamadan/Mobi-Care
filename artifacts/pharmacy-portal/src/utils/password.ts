import { PharmacyUser, PasswordPolicy } from "@workspace/api-client-react";

export function calculateDaysRemaining(user: PharmacyUser | null, policy: PasswordPolicy | null | undefined): number | null {
  if (!user || !policy || !user.passwordLastChangedAt) return null;
  const lastChanged = new Date(user.passwordLastChangedAt).getTime();
  const maxAgeMs = policy.maxPasswordAgeDays * 24 * 60 * 60 * 1000;
  const expiryDate = lastChanged + maxAgeMs;
  const daysRemaining = (expiryDate - Date.now()) / (24 * 60 * 60 * 1000);
  return Math.ceil(daysRemaining);
}

export function isInsideWarningWindow(user: PharmacyUser | null, policy: PasswordPolicy | null | undefined): boolean {
  const daysRemaining = calculateDaysRemaining(user, policy);
  return daysRemaining !== null && daysRemaining > 0 && daysRemaining <= (policy?.passwordExpiryWarningDays || 0);
}

export function checkPasswordStrength(password: string): "weak" | "medium" | "strong" {
  if (!password) return "weak";
  let score = 0;
  
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  
  if (/(.)\1{2,}/.test(password)) score -= 1;
  if (/^[a-zA-Z0-9]+$/.test(password) && password.length < 10) score -= 1;
  if (/(password|qwerty|letmein|123456|abcdef)/i.test(password)) score -= 2;

  if (score <= 2) return "weak";
  if (score <= 4) return "medium";
  return "strong";
}
