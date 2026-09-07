# Object storage migration — step 3

Part of the deployment handover; the order of work is in
[README.md](README.md).

Replacing Replit App Storage with S3-compatible storage. This is what blocks
every image feature off the old host: prescriptions, patient profile photos,
courier photos, HQ team photos, and advertisement media.

## Why it must change

`artifacts/api-server/src/lib/objectStorage.ts` authenticates through a Replit
credential sidecar at `http://127.0.0.1:1106`. Nothing listens there anywhere
else — confirmed by probing it: connection refused. Every upload and every image
read fails the moment the API runs off Replit.

The replacement lives in `artifacts/api-server/src/lib/storage/` and is additive:
the Replit adapter is untouched and still works, so this can be switched on and
off.

## Why not `/public/assets/`

GoDaddy Node.js Hosting offers persistent files under `/public/assets/`, which is
served publicly. Prescription images are medical records, and `objectAcl.ts`
exists to keep them private and application-authorised. Putting them there would
expose patient data to anyone holding the URL. Private object storage is not
optional here.

S3, Cloudflare R2 and Backblaze B2 are all reached over HTTPS on 443, so the
host's outbound port restriction is not a problem for this piece.

## What was built

| File | Purpose |
|---|---|
| `src/lib/storage/sigv4.ts` | AWS Signature V4, header and presigned-URL modes |
| `src/lib/storage/s3Client.ts` | Minimal S3 REST client over `fetch` |
| `src/lib/storage/storedObject.ts` | Object handle replacing the Google `File` |
| `src/lib/storage/objectAcl.ts` | Same ACL rules, stored as S3 metadata |
| `src/lib/storage/objectStorage.ts` | Drop-in `ObjectStorageService` |
| `scripts/migrate-object-storage.ts` | Copies existing objects across, verified |
| `"Final Deployment files/scripts/switch-object-storage.sh"` | Switches imports either way |

Both adapters expose `uploadObjectEntity()` and `isObjectStorageConfigured()`.
`routes/patient/uploads.ts` and `routes/patient/profile.ts` previously computed
object keys themselves by parsing `PRIVATE_OBJECT_DIR`, which tied route code to
one provider's key layout. They now call the service, so they work under either
adapter with no provider-specific configuration of their own.

**No new dependencies.** Signing is implemented against `node:crypto` and
`fetch`. This keeps `package.json` untouched, avoids adding an SDK to a
workspace that pins versions deliberately, and keeps all traffic on plain HTTPS.

Works with any S3-compatible provider: AWS S3, Cloudflare R2, Backblaze B2,
MinIO.

## Configuration

```bash
S3_ENDPOINT=https://s3.eu-west-1.amazonaws.com   # service origin, no bucket
S3_REGION=eu-west-1
S3_BUCKET=mobicare-media
S3_ACCESS_KEY_ID=...                              # secret
S3_SECRET_ACCESS_KEY=...                          # secret

# Optional
S3_PRIVATE_PREFIX=private     # default "private"
S3_PUBLIC_PREFIX=public       # default "public"; comma-separated for several
S3_FORCE_PATH_STYLE=true      # default true; set false for AWS virtual-hosted
S3_SESSION_TOKEN=...          # only for temporary credentials
```

Endpoints by provider:

- **AWS S3** — `https://s3.<region>.amazonaws.com`
- **Cloudflare R2** — `https://<account-id>.r2.cloudflarestorage.com`, region `auto`
- **Backblaze B2** — `https://s3.<region>.backblazeb2.com`

The bucket must **not** be public. Objects are served through the API, which
enforces the ACL on each read.

`PRIVATE_OBJECT_DIR` is **not** needed once the S3 adapter is selected. It
remains the Replit adapter's own configuration, so it still matters if you
revert.

### Two scripts that stay on the old provider

`scripts/migrate-object-storage.ts` reads through the Replit client by design —
it is the source side of the copy.

`scripts/seed-team-photos.ts` is a one-off seeder that also uses the Replit
client and `PRIVATE_OBJECT_DIR`. It is not rewritten and will not work after the
move. It does not need to: team photos already in storage come across with
everything else in the object migration. If team photos ever need re-seeding on
the new provider, that script needs porting first.

## Switching over

```bash
bash "Final Deployment files/scripts/switch-object-storage.sh"            # to S3
bash "Final Deployment files/scripts/switch-object-storage.sh" --revert   # back to Replit
```

It rewrites import paths in 11 files and nothing else. Both directions were run
and verified to be exact inverses — after a switch and a revert the tree is
byte-identical to where it started.

It rewrites all of `src/`, not only `routes/`. `error-boundary.test.ts` imports
`ObjectNotFoundError` as well, and route handlers detect it with `instanceof`.
Leaving the test on the old module produces two distinct classes of the same
name, and a missing image then returns 500 instead of 404 — which is exactly how
this was caught.

## Migrating the objects

Run **on the old host**, where the sidecar exists:

```bash
cd artifacts/api-server
pnpm exec esbuild scripts/migrate-object-storage.ts --bundle --platform=node \
  --format=cjs --outfile=dist/migrate-object-storage.cjs --log-level=warning

PRIVATE_OBJECT_DIR=/<bucket-id>/private \
S3_ENDPOINT=... S3_REGION=... S3_BUCKET=... \
S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
  node dist/migrate-object-storage.cjs --dry-run     # then without --dry-run
```

Each object is copied, read back, and compared by SHA-256 — not just by size, so
a truncated or re-encoded object fails rather than passing quietly. Keys are
preserved exactly, so `/objects/...` paths already in the database keep
resolving. Nothing is deleted from the source. Re-running skips what is already
present, so an interrupted run resumes.

**The ACL key is translated during the copy.** Google stored the policy under
`custom:aclPolicy`; a colon is not legal in an HTTP header name, so S3 stores it
as `x-amz-meta-acl-policy`. The migration rewrites it and then verifies it
persisted. This matters: an object that arrives without its policy reads as
"no policy", and no policy means **nobody** can read it — private media would
silently 403 for its own owner.

## What is verified, and what is not

Verified here, by running it:

- All three of AWS's published SigV4 example signatures reproduce exactly —
  header-signed GET, header-signed PUT with a percent-encoded key, and a
  presigned GET
- 13 adapter tests against an in-process S3 server that **recomputes and checks
  every signature**, so a signing bug fails the test rather than surfacing as a
  403 in production
- Upload, download, delete, ACL round trip, presigned upload accepted, tampered
  presigned URL rejected, traversal and unknown paths refused, keys containing
  spaces and non-ASCII characters
- An object with a missing or corrupt policy is readable by nobody — a corrupt
  policy denies rather than opens
- Private objects get `Cache-Control: private`; only an explicitly public policy
  gets `public`
- With the switch applied: the API typechecks, builds, and the full test suite
  passes 31/31
- After reverting: typecheck and 31/31 again

Not verified, and needing a real provider before launch:

- Any call against a live S3 provider. The mock implements the API faithfully
  and checks signatures, but only a real bucket proves credentials, permissions,
  CORS for browser uploads, and regional endpoint behaviour.
- Browser CORS on presigned PUT. HQ media upload goes directly from the browser
  to the provider, so the bucket needs a CORS rule allowing `PUT` from the
  gateway and portal origins.
- The migration script end to end — it can only run where the source exists.
- Throughput on large advertisement videos. Uploads use a single request rather
  than multipart, which is fine for images and short clips but not for very
  large files.

## Before switching traffic

1. Create the bucket, private, with credentials scoped to it alone
2. Add a CORS rule for `PUT` from the gateway and portal origins
3. Set the S3 variables above (`PRIVATE_OBJECT_DIR` is not needed)
4. Run the migration with `--dry-run`, then for real
5. Run the switch script, then typecheck, test and build
6. Exercise every media path: prescription upload and read, patient profile
   photo, courier photo, HQ team photo, advertisement image and video
7. Confirm a prescription URL is **not** readable by a signed-out browser or by
   a different patient
8. Restart the API and confirm the same media still loads
9. Only then decommission the old storage — after a verified backup
