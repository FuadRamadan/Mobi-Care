---
name: External API connections
description: Durable security and extensibility rules for HQ-managed third-party provider credentials.
---

Use one provider-neutral connection registry for all external institutions. Keep provider-specific validation and network calls in dedicated adapters, while sharing encrypted credential storage, public configuration, status, enablement, and test history.

**Why:** HQ needs to add Orange products, banks, insurers, and other institutions over time without creating a credential table for every provider. A shared registry keeps the storage and security model consistent.

Production provider calls must read the enabled HQ-managed connection record at send time; deployment environment variables must not become a second, conflicting credential source.

**Why:** HQ administrators need to add or rotate Orange credentials without a code change or redeployment, and the settings shown in the portal must be the settings the application actually uses.

**How to apply:** Never return saved credentials or include them in logs/audits. Preserve omitted credentials during replacement, require a live database-backed HQ permission for every management/test route, block tests while disabled, rate-limit side-effecting tests, and use fixed allowlisted provider endpoints rather than user-controlled URLs. Keep an unconfigured provider disabled while allowing the application to start normally.

For the general HQ API workspace, treat every saved header and query-parameter value as potentially sensitive: encrypt all values at rest, expose only fixed masks, and preserve a masked value only when its public key still matches the authenticated encrypted payload. Do not allow query strings or fragments in the saved URL.

**Why:** Credential-name deny lists are bypassable because providers use arbitrary names. Encrypting every value makes the security boundary independent of naming conventions and prevents database/API reads from exposing request credentials.

**How to apply:** Execute only public HTTPS destinations on port 443; validate every resolved address, pin the validated DNS result for the socket, reject redirects and reserved/internal addresses, cap time and response size, and use a durable cross-replica rate limit. Commit an audit intent before dispatch, then atomically save the bounded result history and completion audit.