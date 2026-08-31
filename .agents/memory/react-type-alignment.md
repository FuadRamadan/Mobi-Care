---
name: React type alignment
description: Why React declaration types must remain aligned across the web and Expo workspaces.
---

Keep `@types/react` and `@types/react-dom` on one React 19.1-compatible release line across the workspace unless the React and React Native runtimes are upgraded together.

**Why:** pnpm hoists declarations imported by third-party component packages. If web packages use React 19.2 declarations while Expo uses React 19.1 declarations, TypeScript can load both identities and reject otherwise identical callback refs in calendar, icon, and other shared UI types.

**How to apply:** When updating React declarations, check the Expo/React Native compatibility line first, update the shared catalog in lockstep, regenerate the lockfile, and confirm each web artifact resolves only that compatible declaration version.