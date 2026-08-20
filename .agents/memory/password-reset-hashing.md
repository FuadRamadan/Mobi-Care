---
name: Password reset hashing
description: Environment-specific package resolution for securely hashing one-time account passwords.
---

When hashing a generated temporary password from CodeExecution, load `bcryptjs` through the API workspace’s exact installed module file rather than importing the package from the repository root.

**Why:** The durable execution sandbox resolves imports from the workspace root, where `bcryptjs` is not directly available, even though the API package has it installed. A bare import fails before any database change.

**How to apply:** Generate the temporary password with Node cryptographic randomness inside a small impure function, load the API package’s exact `bcryptjs` module file there, store only the resulting hash, and never put the password or hash in project memory.