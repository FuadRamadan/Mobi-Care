/**
 * A handle to one stored object.
 *
 * Replaces the Google Cloud Storage `File` that routes pass between
 * ObjectStorageService methods. Routes do more than carry it around: HQ upload
 * flows call getMetadata() to check that what a client actually uploaded
 * matches the content type and size that were authorised, and delete() to
 * discard rejected media. Both are reproduced here with the same shapes, so
 * route code needs no changes.
 */

import { deleteObject, headObject, type ObjectMetadata } from "./s3Client.js";

/**
 * Metadata in the shape the Google client returned, because call sites read
 * `contentType` and `size` off it directly.
 */
export interface StoredObjectMetadata {
  contentType: string;
  /** Bytes. Numeric here; the Google client returned a string in some paths. */
  size: number;
  /** User metadata, including the ACL policy. */
  metadata: ObjectMetadata;
}

export class StoredObject {
  constructor(
    /** Bucket the object lives in. */
    readonly bucket: string,
    /** Full object key, e.g. "private/uploads/<uuid>.jpg". */
    readonly key: string,
    /**
     * Metadata from the lookup that produced this handle, when one was made.
     * Lets ACL checks avoid a second round trip.
     */
    readonly metadata?: ObjectMetadata,
    /** Content type from the same lookup, when known. */
    readonly contentType?: string,
    /** Size from the same lookup, when known. */
    readonly contentLength?: number | null,
  ) {}

  /** Object name, matching the Google client's `File.name`. */
  get name(): string {
    return this.key;
  }

  /**
   * Fetch current metadata.
   *
   * Deliberately re-reads rather than returning what the handle was built with:
   * callers use this to validate media a client uploaded after the handle was
   * created, and stale values would let a client pass a check against the size
   * and type it declared rather than the bytes it sent.
   *
   * Returned as a one-element tuple to match the Google client's shape, which
   * call sites destructure.
   */
  async getMetadata(): Promise<[StoredObjectMetadata]> {
    const head = await headObject(this.key);
    if (!head) {
      const error = new Error(`Object not found: ${this.key}`);
      error.name = "ObjectNotFoundError";
      throw error;
    }
    return [
      {
        contentType: head.contentType,
        size: head.contentLength ?? 0,
        metadata: head.metadata,
      },
    ];
  }

  /**
   * Delete the object.
   *
   * `ignoreNotFound` is accepted for call-site compatibility. S3 deletes are
   * already idempotent — removing an absent key succeeds — so an absent object
   * is never an error either way.
   */
  async delete(_options: { ignoreNotFound?: boolean } = {}): Promise<void> {
    await deleteObject(this.key);
  }

  async exists(): Promise<[boolean]> {
    return [(await headObject(this.key)) !== null];
  }
}

export function storedObject(
  bucket: string,
  key: string,
  extra: {
    metadata?: ObjectMetadata;
    contentType?: string;
    contentLength?: number | null;
  } = {},
): StoredObject {
  return new StoredObject(
    bucket,
    key,
    extra.metadata,
    extra.contentType,
    extra.contentLength,
  );
}
