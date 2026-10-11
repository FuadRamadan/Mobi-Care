MobiCare release bundle. Upload THIS, not the repository.

How the hosting app must be configured:

  Start command     node dist/index.mjs
  Build command     none - leave it empty; everything here is already built
  Install step      none - this bundle declares no dependencies

  Do not route the start command through npm, pnpm or yarn. Some hosts cannot
  run a package manager at all (corepack downloads one and then cannot execute
  it), and none is needed: dist/index.mjs runs on Node by itself.

  Uploading the repository instead of this bundle is the usual cause of a
  failed deploy. The repository is a pnpm workspace: the host then tries to
  install and build it, which is slower, needs development dependencies, and
  fails on hosts where corepack cannot run.

Required environment variables:

  NODE_ENV=production
  DATABASE_URL          PostgreSQL, reached over WebSocket on 443
  DATABASE_DRIVER=neon  required where only ports 80/443 are open outbound
  JWT_SECRET            openssl rand -hex 32
  SESSION_SECRET        openssl rand -hex 32 (a different value)
  ALLOWED_ORIGINS       the public HTTPS origin, e.g. https://mobicare.sl
  SMS_TRANSPORT=orange
  SERVE_STATIC_DIR=./public
  TRUST_PROXY_HOPS=1

  S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
                        private object storage for prescriptions and photos

PORT is supplied by the platform.

The database schema must be current before this starts; the API checks on
startup and exits if it is behind. See Final Deployment files/5-BUILD-AND-DEPLOY.md.
