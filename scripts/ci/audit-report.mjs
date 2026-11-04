// Turns `npm audit --json` into something readable on the PR page: a
// Markdown table for the job summary and one annotation per vulnerable
// package, instead of a wall of text at the end of a long log.
//
// Usage: npm audit --omit=dev --json > audit.json || true
//        node scripts/ci/audit-report.mjs audit.json --level high --mode error --title "Production dependencies"
//
// --mode error   exits 1 when anything at or above --level is found (blocking)
// --mode warning always exits 0, annotations are warnings (advisory)

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

const rank = (severity) => SEVERITIES.indexOf(severity);

// `fixAvailable` is true, false, or the package+version npm would install.
function describeFix(fix) {
  if (fix === true) return "`npm audit fix`";
  if (fix && typeof fix === "object") {
    const how = `${fix.name}@${fix.version}`;
    return fix.isSemVerMajor ? `${how} (major: needs \`--force\`)` : how;
  }
  return "none yet";
}

// A package's `via` mixes advisories (objects) with names of the
// vulnerable packages it depends on (strings).
function describeCause(vuln) {
  const advisories = vuln.via.filter((v) => typeof v === "object");
  if (advisories.length > 0) {
    return advisories.map((a) => `[${a.title}](${a.url})`).join("<br>");
  }
  return `via ${vuln.via.join(", ")}`;
}

export function findVulnerabilities(audit, level) {
  return Object.values(audit.vulnerabilities ?? {})
    .filter((v) => rank(v.severity) >= rank(level))
    .sort((a, b) => rank(b.severity) - rank(a.severity) || a.name.localeCompare(b.name));
}

export function renderSummary(vulns, { title, level }) {
  if (vulns.length === 0) {
    return `### ${title}: no ${level} or worse vulnerabilities\n`;
  }
  const rows = vulns.map(
    (v) =>
      `| \`${v.name}\`${v.isDirect ? "" : " (transitive)"} | ${v.severity} | ${v.range} | ${describeCause(v)} | ${describeFix(v.fixAvailable)} |`,
  );
  return [
    `### ${title}: ${vulns.length} package(s) at ${level} or worse`,
    "",
    "| Package | Severity | Vulnerable versions | Advisory | Fix |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "Fix locally with `npm audit fix` (or bump the direct dependency), using Node 24's npm so the lockfile matches CI's.",
    "",
  ].join("\n");
}

// Workflow commands need %, CR and LF escaped in their message.
const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

export function renderAnnotations(vulns, { mode, title }) {
  return vulns.map((v) => {
    const advisories = v.via.filter((x) => typeof x === "object").map((a) => a.title);
    const cause = advisories.length > 0 ? advisories.join("; ") : `via ${v.via.join(", ")}`;
    return `::${mode} title=${escape(`${title}: ${v.name} (${v.severity})`)}::${escape(
      `${cause}. Fix: ${describeFix(v.fixAvailable).replace(/`/g, "")}`,
    )}`;
  });
}

function parseArgs(argv) {
  const [file, ...rest] = argv;
  const opts = { file, level: "high", mode: "error", title: "Dependency audit" };
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  if (!file || !SEVERITIES.includes(opts.level) || !["error", "warning"].includes(opts.mode)) {
    throw new Error("usage: audit-report.mjs <audit.json> [--level high] [--mode error|warning] [--title text]");
  }
  return opts;
}

export function main(argv, env = process.env) {
  const opts = parseArgs(argv);
  const audit = JSON.parse(readFileSync(opts.file, "utf8"));
  // npm reports registry/network failures as {"error": {...}}: say so
  // rather than reading it as "no vulnerabilities".
  if (audit.error) {
    console.log(`::error title=${escape(opts.title)}: npm audit failed::${escape(audit.error.summary ?? JSON.stringify(audit.error))}`);
    return 1;
  }
  const vulns = findVulnerabilities(audit, opts.level);
  const summary = renderSummary(vulns, opts);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary + "\n");
  console.log(summary);
  for (const line of renderAnnotations(vulns, opts)) console.log(line);
  return opts.mode === "error" && vulns.length > 0 ? 1 : 0;
}

/* v8 ignore start -- CLI entry point */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
/* v8 ignore stop */
