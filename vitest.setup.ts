import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { resetTestLocale } from "./src/test/intl";

// Every server component translates through @/i18n/server, which reads the
// session, cookies and database to pick a language. Unit tests get real
// messages without any of that: English by default, French via
// setTestLocale (src/test/intl.ts). src/i18n/server.test.ts unmocks it to
// test the real thing.
vi.mock("@/i18n/server", async () => (await import("./src/test/intl")).fakeIntlServer);

afterEach(() => resetTestLocale());
