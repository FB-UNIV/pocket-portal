#!/usr/bin/env node
// Generates a CycloneDX SBOM at sbom.cdx.json (gitignored). CI runs it to
// attest the SBOM onto each image (docker-build.yml) and attach it to each
// release (release-sbom.yml); see .claude/rules/dependencies.md.
//
// `npm sbom` embeds a random serialNumber and a timestamp on every run;
// the timestamp is dropped and the serialNumber derived from the content
// below, so one commit's SBOM is the same on every CI run. It walks the installed node_modules, whose optional platform
// packages differ by environment, so a local run can differ from CI's.
//
// npm names the root component after the directory it runs in, so the
// root is renamed from package.json below: the output doesn't depend on
// what the checkout is called.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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

// CycloneDX tools need a serialNumber: actions/attest refuses a BOM
// without one ("Unsupported SBOM format"). npm's is random, so derive it
// from the content instead: a name-based UUID (v5 layout, SHA-256), the
// same for the same dependency tree.
const digest = createHash("sha256").update(JSON.stringify(bom)).digest();
digest[6] = (digest[6] & 0x0f) | 0x50;
digest[8] = (digest[8] & 0x3f) | 0x80;
const hex = digest.subarray(0, 16).toString("hex");
bom.serialNumber = `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

writeFileSync("sbom.cdx.json", JSON.stringify(bom, null, 2) + "\n");
