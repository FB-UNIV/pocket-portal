import type { Locale } from "./locales";
import type { Messages } from "./messages";

// Types every translator: an unknown namespace or key is a tsc error, not
// a raw key shown to someone at runtime.
declare module "use-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
