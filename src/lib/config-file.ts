import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { CONFIG_VARS } from "@/lib/config";

// The optional YAML config file, for deployers who'd rather keep
// settings in a file (a compose volume, a k8s ConfigMap) than in env vars.
//
// Node only (it reads a file), so instrumentation imports it dynamically in
// its Node branch. It runs once at boot and writes into process.env, rather
// than being consulted per read, for two reasons: next-auth and the OTel SDK
// read their variables from process.env themselves, and every Next bundle
// shares process.env, where module state may not be shared.

type Env = Record<string, string | undefined>;

const BY_KEY = new Map(CONFIG_VARS.map((v) => [v.yaml, v]));
const SECTIONS = new Set(CONFIG_VARS.map((v) => v.yaml.split(".")[0]));

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// File text to env-var values, plus every problem found (never throws).
export function parseConfigFile(text: string): { values: Env; problems: string[] } {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (error) {
    return { values: {}, problems: [`not valid YAML: ${(error as Error).message}`] };
  }
  if (doc === null || doc === undefined) return { values: {}, problems: [] };
  if (!isMapping(doc)) return { values: {}, problems: ["the top level must be a mapping of sections"] };

  const values: Env = {};
  const problems: string[] = [];
  for (const [section, entries] of Object.entries(doc)) {
    if (!SECTIONS.has(section)) {
      problems.push(`Unknown key "${section}"`);
      continue;
    }
    if (!isMapping(entries)) {
      problems.push(`"${section}" must be a section of keys, not a single value`);
      continue;
    }
    for (const [key, value] of Object.entries(entries)) {
      const path = `${section}.${key}`;
      const known = BY_KEY.get(path);
      if (!known) {
        problems.push(`Unknown key "${path}"`);
      } else if (known.secret) {
        problems.push(
          `${path} is a secret (${known.name}) and can't be set in the config file; ` +
            `set ${known.name} or ${known.name}_FILE in the environment`,
        );
      } else if (["string", "number", "boolean"].includes(typeof value)) {
        values[known.name] = String(value);
      } else {
        problems.push(`${path} must be a single value (a string, number or boolean)`);
      }
    }
  }
  return { values, problems };
}

// Reads CONFIG_FILE, if set, into `env` wherever the environment doesn't
// already set the variable: environment > file > default. An empty value
// counts as unset, as it does for every reader: compose maps an unset host
// variable to "". Problems inside the file are returned for startup to log;
// a file that was asked for and can't be read at all throws, since booting
// past it would run with half the settings silently missing.
export function applyConfigFile(
  env: Env = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string[] {
  const path = env.CONFIG_FILE;
  if (!path) return [];

  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    throw new Error(`CONFIG_FILE "${path}" could not be read: ${(error as Error).message}`, {
      cause: error,
    });
  }

  const { values, problems } = parseConfigFile(text);
  for (const [name, value] of Object.entries(values)) {
    if (!env[name]) env[name] = value;
  }
  return problems.map((problem) => `${path}: ${problem}`);
}

/* v8 ignore next 3 -- the real exit; tests inject one */
function exitProcess(code: number): never {
  return process.exit(code);
}

// Boot-time wrapper for instrumentation: an unreadable CONFIG_FILE exits the
// process. Not a throw: a throw from register() leaves Next's process up,
// answering every request with 500, which a restart policy or probe handles
// worse than a clean exit. Lives here, not in instrumentation.ts, because
// that file is also bundled for the Edge runtime, which has no process.exit.
export function applyConfigFileAtBoot(
  log: { fatal: (obj: object, msg: string) => void },
  exit: (code: number) => never = exitProcess,
  env: Env = process.env,
  readFile?: (path: string) => string,
): string[] {
  try {
    return applyConfigFile(env, readFile);
  } catch (error) {
    log.fatal({ error }, `Configuration: ${(error as Error).message}`);
    return exit(1);
  }
}
