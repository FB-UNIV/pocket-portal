import { describe, it, expect } from "vitest";
import { LOCALES } from "./locales";
import { MESSAGES } from "./messages";

// Every message as "Namespace.key" → text.
function flatten(messages: object, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value as object, path)) out.set(k, v);
  }
  return out;
}

// The arguments a message takes: a name straight after "{" and followed by
// "}" or "," ({name}, {count, plural, …}). A select branch's text, like
// "{Hi {name}.}", isn't one. A set, since branches repeat arguments.
function argumentsOf(message: string): string[] {
  return [
    ...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1])),
  ].sort();
}

const english = flatten(MESSAGES.en);

describe.each(LOCALES.filter((locale) => locale !== "en"))("%s messages", (locale) => {
  const translated = flatten(MESSAGES[locale]);

  it("have exactly the keys English has", () => {
    expect([...translated.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it("take the same arguments as English, message by message", () => {
    for (const [key, text] of english) {
      expect({ key, args: argumentsOf(translated.get(key) ?? "") }).toEqual({
        key,
        args: argumentsOf(text),
      });
    }
  });

  it("are never empty", () => {
    for (const [key, text] of translated) {
      expect({ key, empty: text.trim() === "" }).toEqual({ key, empty: false });
    }
  });
});

// French typography: a no-break space before ? ! : ; so the mark never
// wraps onto a line of its own. A plain space there is a typo.
describe("French typography", () => {
  it("never puts a plain space before ? ! : ;", () => {
    for (const [key, text] of flatten(MESSAGES.fr)) {
      expect({ key, plainSpace: / [?!:;]/.test(text) }).toEqual({ key, plainSpace: false });
    }
  });
});
