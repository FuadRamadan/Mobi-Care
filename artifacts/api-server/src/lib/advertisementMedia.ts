import { asc, inArray } from "drizzle-orm";
import {
  db,
  advertisementMediaTable,
  type Advertisement,
  type AdvertisementMedia,
} from "@workspace/db";

/** Most extra pictures one promotion may carry, after its first one. */
export const MAX_EXTRA_MEDIA = 10;

/** Extra pictures for each promotion, in display order. */
export async function loadExtraMedia(
  advertisementIds: string[],
): Promise<Map<string, AdvertisementMedia[]>> {
  const byAdvertisement = new Map<string, AdvertisementMedia[]>();
  if (advertisementIds.length === 0) return byAdvertisement;
  const rows = await db
    .select()
    .from(advertisementMediaTable)
    .where(inArray(advertisementMediaTable.advertisementId, advertisementIds))
    .orderBy(asc(advertisementMediaTable.sortOrder), asc(advertisementMediaTable.createdAt));
  for (const row of rows) {
    byAdvertisement.set(row.advertisementId, [...(byAdvertisement.get(row.advertisementId) ?? []), row]);
  }
  return byAdvertisement;
}

/** Every picture of a promotion, the one on the advertisement row first. */
export function mediaList(advertisement: Advertisement, extras: AdvertisementMedia[] = []) {
  return [
    {
      id: advertisement.id,
      mediaKind: advertisement.mediaKind,
      alt: advertisement.alt,
      url: `/api/advertisements/${advertisement.id}/media`,
    },
    ...extras.map((extra) => ({
      id: extra.id,
      mediaKind: extra.mediaKind,
      alt: extra.alt,
      url: `/api/advertisements/${advertisement.id}/media/${extra.id}`,
    })),
  ];
}
