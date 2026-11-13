import { logger as defaultLogger } from "@/lib/observability/logger";
import {
  recordNotification,
  type NotificationKind,
  type NotificationOutcome,
} from "@/lib/observability/metrics";
import { getPocketIdConfig, listPocketIdUsers, type PocketIdUser } from "@/lib/pocketid/client";
import type { AccessRequest, AccessRequestDecision } from "@/lib/requests/access-requests";
import { readMailConfig, type MailMessage } from "./mail";
import type { QueuedEmail } from "./outbox";
import { createOutboxStore } from "./outbox-store";
import { drainOutbox } from "./outbox-runtime";
import {
  configSource,
  readAuthUrl,
  readDefaultLocale,
  readEmailNotificationsEnabled,
  readNotifyAdminEmails,
  type ConfigSource,
} from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { getSavedLocale } from "@/lib/preferences/locale";
import { pickLocale, type Locale } from "@/i18n/locales";
import { translatorFor } from "@/i18n/translate";

// Access-request emails (ADR-0011). The actions schedule these with after()
// once the change has committed; this resolves the recipients, renders one
// email each in their language, queues them in the outbox, and sends what's
// due straight away. Anything that fails later is retried from the outbox.
// Nothing here throws: the request is already filed.

type NotifiedRequest = Pick<
  AccessRequest,
  "id" | "requesterSubject" | "requesterEmail" | "pocketIdGroupName" | "message"
>;

interface Deps {
  env: ConfigSource;
  log: Pick<typeof defaultLogger, "warn">;
  // Into the outbox, one row per recipient.
  queue: (emails: QueuedEmail[]) => Promise<void>;
  // Send what's due now, rather than at the sender loop's next pass.
  drain: () => Promise<void>;
  listUsers: () => Promise<Pick<PocketIdUser, "id" | "email" | "isAdmin" | "disabled">[]>;
  // The language a person reads their email in, by PocketID subject (#64);
  // undefined for an address from NOTIFY_ADMIN_EMAILS.
  localeOf: (subject: string | undefined) => Promise<Locale>;
  // portal_notifications_total: queued here; sent, retried and failed in
  // the outbox.
  record: (kind: NotificationKind, outcome: NotificationOutcome) => void;
}

/* v8 ignore start -- wiring only; the tests inject every dependency */
const DEFAULTS: Deps = {
  // A getter, so the source is read at send time, not at import.
  get env() {
    return configSource();
  },
  log: defaultLogger,
  queue: (emails) => createOutboxStore(getDb()).enqueue(emails),
  drain: () => drainOutbox(),
  record: recordNotification,
  listUsers: () => listPocketIdUsers(getPocketIdConfig()),
  // Their saved language, else the portal's default: there's no browser to
  // ask. Unreadable falls back too: a language isn't worth a lost email.
  localeOf: async (subject) => {
    const saved = subject ? await getSavedLocale(getDb(), subject).catch(() => null) : null;
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
  // Their PocketID subject, for their saved language; none for an address
  // from NOTIFY_ADMIN_EMAILS.
  subject?: string;
}

async function deliver(
  deps: Deps,
  kind: NotificationKind,
  request: Pick<NotifiedRequest, "id" | "pocketIdGroupName">,
  recipients: () => Promise<Recipient[]>,
  compose: (locale: Locale) => Omit<MailMessage, "to">,
): Promise<void> {
  const requestId = request.id;
  // Paused: nothing is read, PocketID included, and nothing is queued.
  if (!readEmailNotificationsEnabled(deps.env)) return;

  let emails: QueuedEmail[];
  try {
    if (!readMailConfig(deps.env)) return;
    const to = await recipients();
    emails = [];
    for (const recipient of to) {
      const message = compose(await deps.localeOf(recipient.subject));
      emails.push({
        kind,
        requestId,
        toEmail: recipient.email,
        subject: message.subject,
        body: message.text,
        pocketIdGroupName: request.pocketIdGroupName,
      });
    }
  } catch (error) {
    deps.log.warn({ error, requestId }, "Access request notification not sent");
    deps.record(kind, "failed");
    return;
  }
  if (emails.length === 0) return;

  try {
    await deps.queue(emails);
  } catch (error) {
    deps.log.warn({ error, requestId }, "Access request notification not queued");
    emails.forEach(() => deps.record(kind, "failed"));
    return;
  }
  emails.forEach(() => deps.record(kind, "queued"));

  // Queued, so it's safe now; a failure here only means the sender loop
  // sends it instead.
  try {
    await deps.drain();
  } catch (error) {
    deps.log.warn({ error, requestId }, "Access request notification queued, not sent yet");
  }
}

// To NOTIFY_ADMIN_EMAILS when set, else every enabled PocketID admin with
// an address, read live (ADR-0007).
export function notifyNewAccessRequest(
  // `alsoAsks`: prerequisites asked for with it (#19), by name, so one
  // email covers both.
  request: NotifiedRequest & { alsoAsks?: string[] },
  deps: Deps = DEFAULTS,
): Promise<void> {
  const alsoAsks = request.alsoAsks ?? [];
  const requester = request.requesterEmail ?? request.requesterSubject;
  const group = request.pocketIdGroupName;
  const review = link(deps.env, "/admin/requests");
  return deliver(
    deps,
    "new_request",
    request,
    async () => {
      // A fixed list when set (ADR-0011), so a new request needn't list
      // PocketID's users.
      const fixed = readNotifyAdminEmails(deps.env);
      if (fixed) return fixed.map((email) => ({ email }));
      // A PocketID user's id is their OIDC subject (see src/auth.ts).
      return (await deps.listUsers())
        .filter((user) => user.isAdmin && !user.disabled && user.email)
        .map((user) => ({ email: user.email as string, subject: user.id }));
    },
    (locale) => {
      const t = translatorFor(locale, "Email");
      return {
        subject: subject(t("newSubject", { group })),
        text: body(
          t("newBody", { requester, group }),
          request.message ? `${t("newReason")}\n${request.message}` : undefined,
          alsoAsks.length > 0 && t("newAlsoAsks", { names: alsoAsks.join(", ") }),
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
    request,
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
