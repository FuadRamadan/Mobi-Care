import {
  getGetUnreadCountQueryKey,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import type { QueryClient } from "@tanstack/react-query";

type MarkNotificationsRead = (variables: {
  data: { ids?: string[] };
}) => Promise<unknown>;

export async function markNotificationsReadAndRefresh(
  markNotificationsRead: MarkNotificationsRead,
  queryClient: Pick<QueryClient, "invalidateQueries">,
  ids?: string[],
) {
  await markNotificationsRead({ data: ids ? { ids } : {} });

  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: getListNotificationsQueryKey(),
    }),
    queryClient.invalidateQueries({
      queryKey: getGetUnreadCountQueryKey(),
    }),
  ]);
}