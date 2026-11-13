import { logger as defaultLogger } from "@/lib/observability/logger";
import {
  recordNotification,
  type NotificationKind,
  type NotificationOutcome,
} from "@/lib/observability/metrics";
import { getPocketIdConfig, listPocketIdUsers, type PocketIdUser } from "@/lib/pocketid/client";
import type { AccessRequest, AccessRequestDecision } from "@/lib/requests/access-requests";
import { readMailConfig, sendMail, type MailConfig, type MailMessage } from "./mail";
import {
  configSource,
  readAuthUrl,
  readDefaultLocale,
  readEmailNotificationsEnabled,
  type ConfigSource,
} from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { getSavedLocale } from "@/lib/preferences/locale";
import { pickLocale, type Locale } from "@/i18n/locales";
import { translatorFor } from "@/i18n/translate";

// Access-request emails. Best-effort by design (ADR-0009): the actions
// schedule these with after() once the change has committed, and nothing
// here throws. A lost email costs a delay, not a decision, since the admin
// queue and /apps show the same state.

type NotifiedRequest = Pick<
  AccessRequest,
  "id" | "requesterSubject" | "requesterEmail" | "pocketIdGroupName" | "message"
>;

interface Deps {
  env: ConfigSource;
  log: Pick<typeof defaultLogger, "warn">;
  send: (config: MailConfig, message: MailMessage) => Promise<void>;
  listUsers: () => Promise<Pick<PocketIdUser, "id" | "email" | "isAdmin" | "disabled">[]>;
  // The language a person reads their email in, by PocketID subject (#64).
  localeOf: (subject: string) => Promise<Locale>;
  // portal_notifications_total: failures show up as a metric, not only in
  // the logs (#16, #5).
  record: (kind: NotificationKind, outcome: NotificationOutcome) => void;
}

/* v8 ignore start -- wiring only; the tests inject every dependency */
const DEFAULTS: Deps = {
  // A getter, so the source is read at send time, not at import.
  get env() {
    return configSource();
  },
  log: defaultLogger,
  send: sendMail,
  record: recordNotification,
  listUsers: () => listPocketIdUsers(getPocketIdConfig()),
  // Their saved language, else the portal's default: there's no browser to
  // ask. Unreadable falls back too: a language isn't worth a lost email.
  localeOf: async (subject) => {
    const saved = await getSavedLocale(getDb(), subject).catch(() => null);
    return pickLocale({ saved, fallback: readDefaultLocale(configSource()) });
  },
};
/* v8 ignore stop */

// Group names are set by a PocketID admin; a line break in a subject would
// start a new header.
function subject(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

// Links only when AUTH_URL pins the public origin: without it, the portal
// doesn't know its own address outside a request.
function link(env: ConfigSource, path: string): string | undefined {
  const origin = readAuthUrl(env);
  return origin ? `${origin}${path}` : undefined;
}

function body(...lines: (string | false | undefined)[]): string {
  return lines.filter((line) => typeof line === "string").join("\n\n") + "\n";
}

// One email per recipient: a shared To: header would show every admin who
// else is an admin, one bad address shouldn't stop the others, and each
// one is written in its recipient's language.
interface Recipient {
  email: string;
  subject: string;
}

async function deliver(
  deps: Deps,
  kind: NotificationKind,
  requestId: string,
  recipients: () => Promise<Recipient[]>,
  compose: (locale: Locale) => Omit<MailMessage, "to">,
): Promise<void> {
  let config: MailConfig | null;
  let to: Recipient[];
  // Paused: nothing is read, PocketID included, and nothing is sent.
  if (!readEmailNotificationsEnabled(deps.env)) return;
  try {
    config = readMailConfig(deps.env);
    if (!config) return;
    to = await recipients();
  } catch (error) {
    deps.log.warn({ error, requestId }, "Access request notification not sent");
    deps.record(kind, "failed");
    return;
  }

  for (const recipient of to) {
    try {
      const message = compose(await deps.localeOf(recipient.subject));
      await deps.send(config, { ...message, to: [recipient.email] });
      deps.record(kind, "sent");
    } catch (error) {
      deps.log.warn({ error, requestId }, "Access request notification not sent");
      deps.record(kind, "failed");
    }
  }
}

// To every enabled PocketID admin with an address, read live (ADR-0007).
export function notifyNewAccessRequest(
  request: NotifiedRequest,
  deps: Deps = DEFAULTS,
): Promise<void> {
  const requester = request.requesterEmail ?? request.requesterSubject;
  const group = request.pocketIdGroupName;
  const review = link(deps.env, "/admin/requests");
  return deliver(
    deps,
    "new_request",
    request.id,
    async () =>
      // A PocketID user's id is their OIDC subject (see src/auth.ts).
      (await deps.listUsers())
        .filter((user) => user.isAdmin && !user.disabled && user.email)
        .map((user) => ({ email: user.email as string, subject: user.id })),
    (locale) => {
      const t = translatorFor(locale, "Email");
      return {
        subject: subject(t("newSubject", { group })),
        text: body(
          t("newBody", { requester, group }),
          request.message ? `${t("newReason")}\n${request.message}` : undefined,
          review && t("newReview", { url: review }),
        ),
      };
    },
  );
}

export function notifyAccessRequestDecision(
  request: NotifiedRequest,
  decision: AccessRequestDecision,
  deps: Deps = DEFAULTS,
): Promise<void> {
  const apps = link(deps.env, "/apps");
  const group = request.pocketIdGroupName;
  const email = request.requesterEmail;
  return deliver(
    deps,
    "decision",
    request.id,
    async () => (email ? [{ email, subject: request.requesterSubject }] : []),
    (locale) => {
      const t = translatorFor(locale, "Email");
      const approved = decision === "approved";
      return {
        subject: subject(t(approved ? "approvedSubject" : "deniedSubject", { group })),
        text: body(
          t(approved ? "approvedBody" : "deniedBody", { group }),
          apps && t("yourApps", { url: apps }),
        ),
      };
    },
  );
}
