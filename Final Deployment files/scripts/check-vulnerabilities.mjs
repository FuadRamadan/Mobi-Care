#!/usr/bin/env node
/**
 * Fails when a package that ships to the server or the websites has a known
 * high or critical vulnerability.
 *
 *   node "Final Deployment files/scripts/check-vulnerabilities.mjs"
 *
 * Runs `pnpm audit` and ignores findings reached only through the Expo mobile
 * app: those are build tools on the developer's machine, not code that runs on
 * the server, and they are fixed by upgrading the Expo SDK. Moderate and low
 * findings are listed but do not fail the check.
 *
 * To fix a finding: update the package that pulls it in, or add an override in
 * pnpm-workspace.yaml lifting the vulnerable versions to the fixed release
 * (see the "Security fixes" block there), then run `pnpm install`.
 */
import { execFileSync } from "node:child_process";

let raw;
try {
  raw = execFileSync("pnpm", ["audit", "--prod", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  // pnpm audit exits non-zero whenever it finds anything; the report is still on stdout.
  raw = error.stdout;
  if (!raw) {
    console.error("Could not run pnpm audit (no network?):", error.message);
    process.exit(2);
  }
}

const report = JSON.parse(raw);
const findings = new Map();
for (const advisory of Object.values(report.advisories ?? {})) {
  for (const finding of advisory.findings) {
    const shipped = finding.paths.filter((path) => !path.split(">")[0].includes("mobicare-mobile"));
    if (!shipped.length) continue;
    const key = `${advisory.module_name}@${finding.version}`;
    const entry = findings.get(key) ?? { severity: advisory.severity, titles: new Set(), fixed: advisory.patched_versions, via: shipped[0] };
    entry.titles.add(advisory.title);
    if (["critical", "high"].includes(advisory.severity)) entry.severity = advisory.severity;
    findings.set(key, entry);
  }
}

const serious = [...findings].filter(([, f]) => f.severity === "critical" || f.severity === "high");
for (const [name, f] of findings) {
  console.log(`${f.severity.padEnd(8)} ${name} (fixed in ${f.fixed}) via ${f.via}\n         ${[...f.titles].join("; ")}`);
}
if (serious.length) {
  console.error(`\n${serious.length} high or critical vulnerabilities in server or website packages. Fix them before releasing.`);
  process.exit(1);
}
console.log(findings.size ? "\nNo high or critical findings in server or website packages." : "No known vulnerabilities in server or website packages.");
