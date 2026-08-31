---
name: External API connections
description: Durable security and extensibility rules for HQ-managed third-party provider credentials.
---

Use one provider-neutral connection registry for all external institutions. Keep provider-specific validation and network calls in dedicated adapters, while sharing encrypted credential storage, public configuration, status, enablement, and test history.

**Why:** HQ needs to add Orange products, banks, insurers, and other institutions over time without creating a credential table for every provider. A shared registry keeps the storage and security model consistent.

**How to apply:** Never return saved credentials or include them in logs/audits. Preserve omitted credentials during replacement, require a live database-backed HQ permission for every management/test route, block tests while disabled, rate-limit side-effecting tests, and use fixed allowlisted provider endpoints rather than user-controlled URLs.