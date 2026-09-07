/**
 * S3-backed replacement for lib/objectStorage.ts.
 *
 * Exports the same names with the same signatures as the Replit adapter, so
 * adopting it is an import-path change in the route files and nothing more:
 *
 *   -import { ObjectStorageService } from "../lib/objectStorage.js";
 *   +import { ObjectStorageService } from "../lib/storage/objectStorage.js";
 *
 * The Replit adapter authenticates through a credential sidecar on
 * 127.0.0.1:1106 that exists only inside Replit, so every image operation fails
 * anywhere else. This one talks to any S3-compatible provider over HTTPS.
 *
 * Object paths are unchanged. The application stores and serves paths of the
 * form "/objects/<entity>", which map to "<S3_PRIVATE_PREFIX>/<entity>" in the
 * bucket, so rows already in the database keep resolving after migration.
 *
 * Configuration: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY, and optionally S3_PRIVATE_PREFIX (default "private"),
 * S3_PUBLIC_PREFIX (default "public"), S3_FORCE_PATH_STYLE, S3_SESSION_TOKEN.
 */

import { randomUUID } from "node:crypto";
import {
  deleteObject,
  getObject,
  getS3Config,
  headObject,
  presignPut,
  putObject,
  type ObjectMetadata,
} from "./s3Client.js";
import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
  type ObjectAclPolicy,
} from "./objectAcl.js";
import { storedObject, type StoredObject } from "./storedObject.js";

export { ObjectPermission } from "./objectAcl.js";
export type { ObjectAclPolicy } from "./objectAcl.js";
export type { StoredObject } from "./storedObject.js";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

const DEFAULT_PRIVATE_PREFIX = "private";
const DEFAULT_PUBLIC_PREFIX = "public";

/** Strip leading and trailing slashes so prefixes join predictably. */
const trim = (value: string): string => value.replace(/^\/+|\/+$/g, "");

function privatePrefix(): string {
  return trim(process.env.S3_PRIVATE_PREFIX || DEFAULT_PRIVATE_PREFIX);
}

function publicPrefixes(): string[] {
  const configured = process.env.S3_PUBLIC_PREFIX || DEFAULT_PUBLIC_PREFIX;
  return Array.from(
    new Set(configured.split(",").map(trim).filter(Boolean)),
  );
}

/**
 * Reject anything that could escape the prefix it is joined to.
 *
 * Keys reaching here derive from request paths, so a traversal segment must not
 * be able to turn "<private>/x" into a read of another prefix.
 */
function assertSafeEntityPath(entityPath: string): void {
  if (!entityPath || entityPath.includes("..") || entityPath.includes("\\")) {
    throw new ObjectNotFoundError();
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const paths = publicPrefixes();
    if (paths.length === 0) {
      throw new Error(
        "S3_PUBLIC_PREFIX resolved to no paths. Set it to one or more " +
          "comma-separated key prefixes.",
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const prefix = privatePrefix();
    if (!prefix) {
      throw new Error(
        "S3_PRIVATE_PREFIX resolved to an empty prefix. Private objects must " +
          "not be stored at the bucket root.",
      );
    }
    return prefix;
  }

  async searchPublicObject(filePath: string): Promise<StoredObject | null> {
    assertSafeEntityPath(filePath);
    const config = getS3Config();

    for (const prefix of this.getPublicObjectSearchPaths()) {
      const key = `${prefix}/${trim(filePath)}`;
      const head = await headObject(key, config);
      if (head) {
        return storedObject(config.bucket, key, {
          metadata: head.metadata,
          contentType: head.contentType,
          contentLength: head.contentLength,
        });
      }
    }

    return null;
  }

  /**
   * Stream an object back to the caller as a web Response.
   *
   * Cache-Control follows the object's own ACL: an object marked public may be
   * cached by shared caches, anything else is marked private so intermediaries
   * do not retain it. Prescriptions depend on that distinction.
   */
  async downloadObject(file: StoredObject, cacheTtlSec: number = 3600): Promise<Response> {
    const object = await getObject(file.key);
    const aclPolicy = await getObjectAclPolicy(
      storedObject(file.bucket, file.key, { metadata: object.metadata }),
    );
    const isPublic = aclPolicy?.visibility === "public";

    const headers: Record<string, string> = {
      "Content-Type": object.contentType || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (object.contentLength !== null) {
      headers["Content-Length"] = String(object.contentLength);
    }

    return new Response(object.stream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
    return presignPut(`${this.getPrivateObjectDir()}/uploads/${objectId}`, 900);
  }

  /**
   * Creates a direct-upload URL for a known object entity path. The caller is
   * responsible for authorising the operation and for setting an ACL after the
   * client has uploaded the object.
   */
  async getObjectEntityUploadInfo(
    entityPath: string,
  ): Promise<{ uploadUrl: string; objectPath: string }> {
    const cleanedPath = entityPath.replace(/^\/+/, "");
    if (!cleanedPath || cleanedPath.includes("..")) {
      throw new Error("Invalid object entity path");
    }

    return {
      uploadUrl: presignPut(`${this.getPrivateObjectDir()}/${cleanedPath}`, 900),
      objectPath: `/objects/${cleanedPath}`,
    };
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObject> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    assertSafeEntityPath(entityId);

    const config = getS3Config();
    const key = `${this.getPrivateObjectDir()}/${entityId}`;
    const head = await headObject(key, config);
    if (!head) {
      throw new ObjectNotFoundError();
    }

    return storedObject(config.bucket, key, {
      metadata: head.metadata,
      contentType: head.contentType,
      contentLength: head.contentLength,
    });
  }

  /**
   * Reduce a raw upload URL to the "/objects/<entity>" form the application
   * stores.
   *
   * Handles the presigned S3 URLs this adapter issues, and still recognises the
   * Google Cloud URLs written by the previous provider so historical rows and
   * in-flight uploads keep normalising correctly.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    if (!/^https?:\/\//i.test(rawPath)) {
      return rawPath;
    }

    let pathname: string;
    try {
      pathname = new URL(rawPath).pathname;
    } catch {
      return rawPath;
    }
    // Presigned URLs are percent-encoded; stored paths are not.
    pathname = decodeURIComponent(pathname);

    const prefix = this.getPrivateObjectDir();
    // Path-style URLs carry the bucket as the first segment; virtual-hosted
    // ones do not. Anchor on the private prefix so both reduce identically.
    const marker = `/${prefix}/`;
    const at = pathname.indexOf(marker);
    if (at === -1) {
      return pathname;
    }

    return `/objects/${pathname.slice(at + marker.length)}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredObject;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      ...(userId === undefined ? {} : { userId }),
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  /** Delete an object by its "/objects/<entity>" path. */
  async deleteObjectEntity(objectPath: string): Promise<void> {
    const file = await this.getObjectEntityFile(objectPath);
    await deleteObject(file.key);
  }
}

/**
 * Server-side upload shim.
 *
 * routes/patient/uploads.ts reaches past the service to the raw provider client
 * to save a buffer directly. This keeps that call site working unchanged by
 * offering the same bucket(...).file(...).save(...) shape, so prescription
 * uploads need no rewrite to move providers.
 */
export const objectStorageClient = {
  bucket(bucketName: string) {
    return {
      file(objectName: string) {
        return {
          name: objectName,
          bucket: bucketName,
          async save(
            body: Buffer,
            options: {
              contentType?: string;
              metadata?: ObjectMetadata;
              /**
               * Accepted for call-site compatibility and ignored: resumable
               * uploads were a Google client concern. Objects here are written
               * in a single request, which suits the few-MB images involved.
               */
              resumable?: boolean;
            } = {},
          ): Promise<void> {
            await putObject(objectName, body, {
              ...(options.contentType ? { contentType: options.contentType } : {}),
              ...(options.metadata ? { metadata: options.metadata } : {}),
            });
          },
          async exists(): Promise<[boolean]> {
            return [(await headObject(objectName)) !== null];
          },
          async delete(): Promise<void> {
            await deleteObject(objectName);
          },
        };
      },
    };
  },
};
