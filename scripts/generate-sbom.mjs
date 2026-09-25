#!/usr/bin/env node
// Generates a deterministic CycloneDX SBOM at sbom.cdx.json.
//
// `npm sbom` embeds a random serialNumber and a timestamp on every run;
// both are stripped below. It also walks the installed node_modules, whose
// optional platform packages differ by environment even from one lockfile
// (`--package-lock-only` would avoid that, but fails on this lockfile with
// ESBOMPROBLEMS). So the output is reproducible only in CI's environment,
// Node 24 on linux-x64: a scratch copy of package.json and the lockfile
// there matches sbom-check.yml byte for byte; see docs/CONTRIBUTING.md.
//
// npm names the root component after the directory it runs in, so the
// root is renamed from package.json below: the output doesn't depend on
// what the checkout is called.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const raw = execFileSync("npm", ["sbom", "--sbom-format", "cyclonedx"], {
  encoding: "utf8",
});

const bom = JSON.parse(raw);
delete bom.serialNumber;
delete bom.metadata?.timestamp;

const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
const root = bom.metadata.component;
const oldRef = root["bom-ref"];
const newRef = `${name}@${version}`;
Object.assign(root, { "bom-ref": newRef, name, purl: `pkg:npm/${name}@${version}` });
for (const dep of bom.dependencies ?? []) {
  if (dep.ref === oldRef) dep.ref = newRef;
}

writeFileSync("sbom.cdx.json", JSON.stringify(bom, null, 2) + "\n");
