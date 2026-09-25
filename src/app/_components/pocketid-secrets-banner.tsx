import { readPocketIdBaseUrl, readSecretsWarningEnabled } from "@/lib/config";
import { getSecretExposure } from "@/lib/pocketid/secret-exposure";

const DOCS_URL = "https://github.com/FB-UNIV/pocket-portal#securing-the-portal";

// Shown on every /admin page while PocketID lets the portal's key read its
// SMTP/LDAP passwords. Fails open: an unreachable PocketID shows nothing.
export async function PocketIdSecretsBanner() {
  const baseUrl = readPocketIdBaseUrl();
  // Silenced by a deployer who accepted the risk; the startup log
  // line in instrumentation still records it.
  if (!baseUrl || !readSecretsWarningEnabled()) return null;
  if ((await getSecretExposure(baseUrl)) !== "readable") return null;

  return (
    <section
      aria-label="Security warning"
      className="w-full border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <strong>PocketID exposes its SMTP/LDAP passwords to this portal&rsquo;s API key.</strong>{" "}
      Set <code>UI_CONFIG_DISABLED=true</code> on PocketID.{" "}
      <a href={DOCS_URL} className="underline">
        Securing the portal
      </a>
    </section>
  );
}
