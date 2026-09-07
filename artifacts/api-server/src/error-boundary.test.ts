import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import fs from "node:fs/promises";
import { mock } from "node:test";
import app from "./app";
import {
  db,
  pharmaciesTable,
  pool,
  prescriptionsTable,
  teamMembersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "./lib/storage/objectStorage";
import { mintImageToken } from "./lib/signedUrl";

const INTERNAL_ERROR = { error: "Internal server error" };

let server: Server;
let baseUrl: string;

const teamMemberId = randomUUID();
const pharmacyId = randomUUID();
const prescriptionId = randomUUID();
const imageFilename = `${randomUUID()}.png`;

async function request(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; text: string; json: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();

  return {
    status: response.status,
    text,
    json: text ? JSON.parse(text) : undefined,
  };
}

function assertInternalError(response: {
  status: number;
  text: string;
  json: unknown;
}): void {
  assert.equal(response.status, 500);
  assert.deepEqual(response.json, INTERNAL_ERROR);
  assert.equal(Object.keys(response.json as object).length, 1);
  assert.doesNotMatch(response.text, /stack|database|filesystem|password/i);
}

function signedPrescriptionImagePath(): string {
  const { token, expiresAt } = mintImageToken(prescriptionId, "preview");
  return `/api/prescription-images/${prescriptionId}?variant=preview&expires=${expiresAt}&sig=${token}`;
}

before(async () => {
  await db.insert(teamMembersTable).values({
    id: teamMemberId,
    slug: `error-boundary-${teamMemberId}`,
    name: "Error Boundary Test Member",
    role: "Test Member",
    photoPath: `/objects/team-photos/${teamMemberId}.jpg`,
    sortOrder: 999,
  });

  await db.insert(pharmaciesTable).values({
    id: pharmacyId,
    name: "Error Boundary Test Pharmacy",
    username: `error-boundary-${pharmacyId}`,
    passwordHash: "not-a-real-password-hash",
  });

  await db.insert(prescriptionsTable).values({
    id: prescriptionId,
    pharmacyId,
    patientName: "Error Boundary Test Patient",
    patientPhone: "+23200000000",
    imageKey: `local:${imageFilename}`,
  });

  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  mock.restoreAll();
  await db
    .delete(prescriptionsTable)
    .where(eq(prescriptionsTable.id, prescriptionId));
  await db.delete(pharmaciesTable).where(eq(pharmaciesTable.id, pharmacyId));
  await db
    .delete(teamMembersTable)
    .where(eq(teamMembersTable.id, teamMemberId));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
});

test("malformed JSON is sanitized by the shared error boundary", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"identifier":',
  });

  assertInternalError(response);
});

test("rejected database routes are sanitized by the shared error boundary", async () => {
  const databaseMock = mock.method(db, "select", () => {
    throw new Error("database connection string leaked");
  });

  try {
    const response = await request(`/api/team/${teamMemberId}/photo`);
    assertInternalError(response);
  } finally {
    databaseMock.mock.restore();
  }
});

test("unexpected storage failures are sanitized by the shared error boundary", async () => {
  const storageMock = mock.method(
    ObjectStorageService.prototype,
    "getObjectEntityFile",
    async () => {
      throw new Error("database credentials leaked from storage adapter");
    },
  );

  try {
    const response = await request(`/api/team/${teamMemberId}/photo`);
    assertInternalError(response);
  } finally {
    storageMock.mock.restore();
  }
});

test("expected missing storage objects remain a 404", async () => {
  const storageMock = mock.method(
    ObjectStorageService.prototype,
    "getObjectEntityFile",
    async () => {
      throw new ObjectNotFoundError();
    },
  );

  try {
    const response = await request(`/api/team/${teamMemberId}/photo`);
    assert.equal(response.status, 404);
    assert.deepEqual(response.json, { error: "Team photo not found" });
  } finally {
    storageMock.mock.restore();
  }
});

test("missing local files remain a 404 while unexpected filesystem failures are sanitized", async () => {
  const fileMock = mock.method(
    fs,
    "readFile",
    async () => {
      const error = new Error("filesystem path details");
      Object.assign(error, { code: "EACCES" });
      throw error;
    },
  );

  try {
    const response = await request(signedPrescriptionImagePath());
    assertInternalError(response);
  } finally {
    fileMock.mock.restore();
  }

  const missingFileMock = mock.method(
    fs,
    "readFile",
    async () => {
      const error = new Error("file does not exist");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    },
  );

  try {
    const response = await request(signedPrescriptionImagePath());
    assert.equal(response.status, 404);
    assert.deepEqual(response.json, { error: "Image file not found" });
  } finally {
    missingFileMock.mock.restore();
  }
});