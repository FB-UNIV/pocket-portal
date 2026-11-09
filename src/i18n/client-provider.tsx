"use client";

// use-intl's provider, as a client component: the package carries no
// "use client" directive of its own. The root layout wraps pages in it with
// only the messages client components need (today: the error page), so the
// rest never ship to the browser. Server components don't use it; they call
// getTranslations (@/i18n/server).
export { IntlProvider } from "use-intl";
