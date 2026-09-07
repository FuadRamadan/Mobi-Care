/**
 * Access-control policy attached to stored objects.
 *
 * Mirrors the rules in lib/objectAcl.ts exactly — same policy shape, same
 * decisions — but reads and writes the policy as S3 user metadata instead of
 * Google Cloud Storage custom metadata.
 *
 * The authorisation logic is deliberately unchanged: prescriptions and patient
 * photos are private and application-authorised, and that must stay true across
 * the storage migration.
 */

import {
  headObject,
  setObjectMetadata,
  S3NotFoundError,
  type ObjectMetadata,
} from "./s3Client.js";
import type { StoredObject } from "./storedObject.js";

/**
 * S3 metadata keys travel as HTTP header suffixes, so the GCS key
 * "custom:aclPolicy" cannot be used verbatim — a colon is not legal in a header
 * name. Objects migrated from the old provider need their policy rewritten
 * under this key; see the migration script.
 */
const ACL_POLICY_METADATA_KEY = "acl-policy";

export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(group: ObjectAccessGroup): BaseObjectAccessGroup {
  switch (group.type) {
    // Implement per access group type, e.g.:
    // case "USER_LIST":
    //   return new UserListAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

/** Render a policy as the metadata map stored alongside the object. */
export function aclPolicyToMetadata(policy: ObjectAclPolicy): ObjectMetadata {
  return { [ACL_POLICY_METADATA_KEY]: JSON.stringify(policy) };
}

/** Read a policy out of an object's metadata, if one is present and parseable. */
export function aclPolicyFromMetadata(
  metadata: ObjectMetadata | undefined,
): ObjectAclPolicy | null {
  const raw = metadata?.[ACL_POLICY_METADATA_KEY];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ObjectAclPolicy;
  } catch {
    // A corrupt policy must not read as "no restrictions". Callers treat null
    // as deny, which is the safe direction.
    return null;
  }
}

export async function setObjectAclPolicy(
  objectFile: StoredObject,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const head = await headObject(objectFile.key);
  if (!head) throw new S3NotFoundError(objectFile.key);

  await setObjectMetadata(objectFile.key, {
    ...head.metadata,
    ...aclPolicyToMetadata(aclPolicy),
  });
}

export async function getObjectAclPolicy(
  objectFile: StoredObject,
): Promise<ObjectAclPolicy | null> {
  // Prefer metadata already fetched for this object; fall back to a HEAD.
  const metadata = objectFile.metadata ?? (await headObject(objectFile.key))?.metadata;
  return aclPolicyFromMetadata(metadata);
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: StoredObject;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  // No policy means no grant. An object whose policy is missing or unreadable
  // is not readable by anyone.
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
