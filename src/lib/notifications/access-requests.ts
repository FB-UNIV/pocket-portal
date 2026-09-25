import { logger as defaultLogger } from "@/lib/observability/logger";
import { getPocketIdConfig, listPocketIdUsers, type PocketIdUser } from "@/lib/pocketid/client";
import type { AccessRequest, AccessRequestDecision } from "@/lib/requests/access-requests";
import { readMailConfig, sendMail, type MailConfig, type MailMessage } from "./mail";
import {
  configSource,
  readAuthUrl,
  readEmailNotificationsEnabled,
  type ConfigSource,
} from "@/lib/config";

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
  listUsers: () => Promise<Pick<PocketIdUser, "email" | "isAdmin" | "disabled">[]>;
}

/* v8 ignore start -- wiring only; the tests inject every dependency */
const DEFAULTS: Deps = {
  // A getter, so the source is read at send time, not at import.
  get env() {
    return configSource();
  },
  log: defaultLogger,
  send: sendMail,
  listUsers: () => listPocketIdUsers(getPocketIdConfig()),
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

async function deliver(
  deps: Deps,
  requestId: string,
  build: (config: MailConfig) => Promise<MailMessage | null>,
): Promise<void> {
  let config: MailConfig | null;
  let message: MailMessage | null;
  // Paused: nothing is read, PocketID included, and nothing is sent.
  if (!readEmailNotificationsEnabled(deps.env)) return;
  try {
    config = readMailConfig(deps.env);
    if (!config) return;
    message = await build(config);
    if (!message) return;
  } catch (error) {
    deps.log.warn({ error, requestId }, "Access request notification not sent");
    return;
  }

  // One email per recipient: a shared To: header would show every admin
  // who else is an admin, and one bad address shouldn't stop the others.
  for (const to of message.to) {
    try {
      await deps.send(config, { ...message, to: [to] });
    } catch (error) {
      deps.log.warn({ error, requestId }, "Access request notification not sent");
    }
  }
}

// To every enabled PocketID admin with an address, read live (ADR-0007).
export function notifyNewAccessRequest(
  request: NotifiedRequest,
  deps: Deps = DEFAULTS,
): Promise<void> {
  return deliver(deps, request.id, async () => {
    const admins = (await deps.listUsers())
      .filter((user) => user.isAdmin && !user.disabled && user.email)
      .map((user) => user.email as string);
    if (admins.length === 0) return null;

    const requester = request.requesterEmail ?? request.requesterSubject;
    const review = link(deps.env, "/admin/requests");
    return {
      to: admins,
      subject: subject(`Access request for ${request.pocketIdGroupName}`),
      text: body(
        `${requester} asked for access to ${request.pocketIdGroupName}.`,
        request.message ? `Their reason:\n${request.message}` : undefined,
        review && `Review it: ${review}`,
      ),
    };
  });
}

export function notifyAccessRequestDecision(
  request: NotifiedRequest,
  decision: AccessRequestDecision,
  deps: Deps = DEFAULTS,
): Promise<void> {
  return deliver(deps, request.id, async () => {
    if (!request.requesterEmail) return null;

    const apps = link(deps.env, "/apps");
    const group = request.pocketIdGroupName;
    return {
      to: [request.requesterEmail],
      subject: subject(`Access to ${group} ${decision}`),
      text:
        decision === "approved"
          ? body(
              `Your request for ${group} was approved. It can take a few minutes to show up in the portal.`,
              apps && `Your apps: ${apps}`,
            )
          : body(
              `Your request for ${group} was denied. You can request it again with more detail.`,
              apps && `Your apps: ${apps}`,
            ),
    };
  });
}
