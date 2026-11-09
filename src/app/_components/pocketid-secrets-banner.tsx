import { readPocketIdBaseUrl, readSecretsWarningEnabled } from "@/lib/config";
import { getSecretExposure } from "@/lib/pocketid/secret-exposure";
import { getTranslations } from "@/i18n/server";

const DOCS_URL = "https://github.com/FB-UNIV/pocket-portal#securing-the-portal";

// Shown on every /admin page while PocketID lets the portal's key read its
// SMTP/LDAP passwords. Fails open: an unreachable PocketID shows nothing.
export async function PocketIdSecretsBanner() {
  const baseUrl = readPocketIdBaseUrl();
  // Silenced by a deployer who accepted the risk; the startup log
  // line in instrumentation still records it.
  if (!baseUrl || !readSecretsWarningEnabled()) return null;
  if ((await getSecretExposure(baseUrl)) !== "readable") return null;
  const t = await getTranslations("SecretsBanner");

  return (
    <section
      aria-label={t("label")}
      className="w-full border-b border-tip-line bg-tip px-6 py-3 text-sm text-on-tip"
    >
      <strong>{t("lead")}</strong>{" "}
      {t.rich("fix", { code: (chunks) => <code>{chunks}</code> })}{" "}
      <a href={DOCS_URL} className="underline">
        {t("docs")}
      </a>
    </section>
  );
}
