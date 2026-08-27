import assert from "node:assert/strict";
import test from "node:test";
import {
  getGetUnreadCountQueryKey,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { markNotificationsReadAndRefresh } from "./notification-read";

function createHarness() {
  const mutationCalls: unknown[] = [];
  const invalidationCalls: unknown[] = [];

  return {
    mutationCalls,
    invalidationCalls,
    markRead: async (variables: unknown) => {
      mutationCalls.push(variables);
    },
    queryClient: {
      invalidateQueries: async (filters: unknown) => {
        invalidationCalls.push(filters);
      },
    },
  };
}

test("marking one notification read refreshes the list and unread badge", async () => {
  const harness = createHarness();

  await markNotificationsReadAndRefresh(
    harness.markRead,
    harness.queryClient,
    ["notification-1"],
  );

  assert.deepEqual(harness.mutationCalls, [
    { data: { ids: ["notification-1"] } },
  ]);
  assert.deepEqual(harness.invalidationCalls, [
    { queryKey: getListNotificationsQueryKey() },
    { queryKey: getGetUnreadCountQueryKey() },
  ]);
});

test("marking all notifications read refreshes the list and unread badge", async () => {
  const harness = createHarness();

  await markNotificationsReadAndRefresh(harness.markRead, harness.queryClient);

  assert.deepEqual(harness.mutationCalls, [{ data: {} }]);
  assert.deepEqual(harness.invalidationCalls, [
    { queryKey: getListNotificationsQueryKey() },
    { queryKey: getGetUnreadCountQueryKey() },
  ]);
});