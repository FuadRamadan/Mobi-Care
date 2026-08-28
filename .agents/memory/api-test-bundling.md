---
name: API test bundling
description: Why bundled API tests use CommonJS and production-style logging.
---

Bundle tests that import the full API application as CommonJS, and run them without development logging transports.

**Why:** ESM bundling leaves CommonJS dependencies unable to perform dynamic Node imports, while the pretty logging transport resolves worker files relative to the test bundle rather than the normal server build.

**How to apply:** When adding tests that import the full Express application, keep the test bundle in CommonJS format and use production or silent logging. This does not apply to isolated tests that never initialize the API logger.