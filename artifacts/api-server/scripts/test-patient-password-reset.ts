import bcrypt from "bcryptjs";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { db } from "@workspace/db";
import {
  patientPasswordResetCodesTable,
  patientsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const BASE_URL =
  (process.env.TEST_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? "4000"}`)
    .replace(/\/$/, "") + "/api";
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) throw new Error("SESSION_SECRET is required");

const suffix = Date.now().toString().slice(-8);
const phone = `+23277${suffix}`;
const oldPassword = `Old_${randomBytes(10).toString("hex")}!`;
const newPassword = `New_${randomBytes(10).toString("hex")}!`;
const code = "482913";
let patientId: string | undefined;
let passed = 0;

function codeHash(requestId: string, value: string) {
  return createHmac("sha256", SESSION_SECRET!)
    .update(`${requestId}:${value}`)
    .digest("hex");
}

function phoneHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function api(path: string, body: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

async function authenticatedGet(path: string, accessToken: string) {
  return fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function expect(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
  passed += 1;
  console.log(`  PASS ${label}`);
}

async function createReset(
  patient: string,
  options: { expiresAt?: Date; attemptCount?: number } = {},
) {
  const requestId = randomUUID();
  await db.insert(patientPasswordResetCodesTable).values({
    id: requestId,
    patientId: patient,
    phoneHash: phoneHash(phone),
    requesterHash: phoneHash("integration-test"),
    codeHash: codeHash(requestId, code),
    attemptCount: options.attemptCount ?? 0,
    expiresAt: options.expiresAt ?? new Date(Date.now() + 10 * 60_000),
  });
  return requestId;
}

async function main() {
try {
  const passwordHash = await bcrypt.hash(oldPassword, 10);
  const [patient] = await db
    .insert(patientsTable)
    .values({ name: "Password Reset Test", phone, passwordHash })
    .returning({ id: patientsTable.id });
  patientId = patient!.id;

  const login = await api("/auth/login", { identifier: phone, password: oldPassword });
  expect(login.status === 200, "old password signs in before reset");
  const refreshToken = login.body.refreshToken as string;
  const accessToken = login.body.accessToken as string;

  const known = await api("/auth/patient-password-reset/request", { phone });
  const unknown = await api("/auth/patient-password-reset/request", {
    phone: `+23288${suffix}`,
  });
  expect(known.status === 200 && unknown.status === 200, "known and unknown numbers receive the same status");
  expect(known.body.message === unknown.body.message, "request response does not reveal account existence");

  const burstPhone = `+23299${suffix}`;
  const burst = await Promise.all(
    Array.from({ length: 5 }, () =>
      api("/auth/patient-password-reset/request", { phone: burstPhone }),
    ),
  );
  expect(
    burst.filter((result) => result.status === 200).length === 1 &&
      burst.filter((result) => result.status === 429).length === 4,
    "concurrent request burst is serialized and throttled",
  );

  const expiredId = await createReset(patientId, {
    expiresAt: new Date(Date.now() - 1000),
  });
  const expired = await api("/auth/patient-password-reset/confirm", {
    requestId: expiredId,
    code,
    newPassword,
  });
  expect(expired.status === 400, "expired code is rejected");

  const lockedId = await createReset(patientId, { attemptCount: 5 });
  const locked = await api("/auth/patient-password-reset/confirm", {
    requestId: lockedId,
    code,
    newPassword,
  });
  expect(locked.status === 400, "over-attempted code is rejected");

  const wrongId = await createReset(patientId);
  const wrong = await api("/auth/patient-password-reset/confirm", {
    requestId: wrongId,
    code: "000000",
    newPassword,
  });
  expect(wrong.status === 400, "incorrect code is rejected");

  const requestId = await createReset(patientId);
  const [first, second] = await Promise.all([
    api("/auth/patient-password-reset/confirm", { requestId, code, newPassword }),
    api("/auth/patient-password-reset/confirm", { requestId, code, newPassword }),
  ]);
  expect(
    [first.status, second.status].sort().join(",") === "200,409",
    "concurrent confirmation has exactly one winner",
  );

  const replay = await api("/auth/patient-password-reset/confirm", {
    requestId,
    code,
    newPassword,
  });
  expect(replay.status === 400, "used code cannot be replayed");

  const oldLogin = await api("/auth/login", { identifier: phone, password: oldPassword });
  const newLogin = await api("/auth/login", { identifier: phone, password: newPassword });
  expect(oldLogin.status === 401 && newLogin.status === 200, "only the new password signs in");

  const refresh = await api("/auth/refresh", { refreshToken });
  expect(refresh.status === 401, "existing patient sessions are revoked");

  const protectedRequest = await authenticatedGet(
    "/patient/notifications",
    accessToken,
  );
  expect(
    protectedRequest.status === 401,
    "existing patient access tokens are invalidated immediately",
  );

  const refreshRaceId = await createReset(patientId);
  const refreshRacePassword = `RefreshRace_${randomBytes(10).toString("hex")}!`;
  const [resetRaceResult, refreshRaceResult] = await Promise.all([
    api("/auth/patient-password-reset/confirm", {
      requestId: refreshRaceId,
      code,
      newPassword: refreshRacePassword,
    }),
    api("/auth/refresh", { refreshToken: newLogin.body.refreshToken }),
  ]);
  expect(resetRaceResult.status === 200, "password reset completes while refresh is racing");
  if (refreshRaceResult.status === 200) {
    const racedAccess = await authenticatedGet(
      "/patient/notifications",
      refreshRaceResult.body.accessToken,
    );
    const racedRefresh = await api("/auth/refresh", {
      refreshToken: refreshRaceResult.body.refreshToken,
    });
    expect(
      racedAccess.status === 401 && racedRefresh.status === 401,
      "refresh racing reset cannot leave a surviving replacement session",
    );
  } else {
    expect(
      refreshRaceResult.status === 401,
      "refresh racing reset is rejected when reset wins the lock",
    );
  }

  const fifthAttemptId = await createReset(patientId, { attemptCount: 4 });
  const racePassword = `Race_${randomBytes(10).toString("hex")}!`;
  const raced = await Promise.all([
    api("/auth/patient-password-reset/confirm", {
      requestId: fifthAttemptId,
      code,
      newPassword: racePassword,
    }),
    api("/auth/patient-password-reset/confirm", {
      requestId: fifthAttemptId,
      code: "000000",
      newPassword: racePassword,
    }),
  ]);
  expect(
    raced.filter((result) => result.status === 200).length <= 1 &&
      raced.some((result) => result.status === 429),
    "fifth failed attempt cannot race into multiple successful resets",
  );

  console.log(`\n${passed}/15 password recovery checks passed`);
} finally {
  if (patientId) {
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  }
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});