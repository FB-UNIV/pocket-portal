import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import ErrorPage from "./error";
import { IntlProvider } from "@/i18n/client-provider";
import { MESSAGES } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";

// The root layout provides the page's language (with only this namespace).
function renderPage(ui: ReactNode, locale: Locale = "en") {
  return render(
    <IntlProvider locale={locale} messages={{ Error: MESSAGES[locale].Error }}>
      {ui}
    </IntlProvider>,
  );
}

describe("ErrorPage", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("announces the failure to assistive technology", () => {
    renderPage(<ErrorPage error={new Error("boom")} retry={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
  });

  // The server actions behind this app throw messages that can name another
  // user's groups or requests; the boundary is rendered client-side, so it
  // shows a generic message and only the digest an operator can grep for.
  it("does not render the raw error message", () => {
    renderPage(
      <ErrorPage error={Object.assign(new Error("boom"), { digest: "abc123" })} retry={vi.fn()} />,
    );

    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("offers a retry that re-renders the segment", async () => {
    const retry = vi.fn();
    renderPage(<ErrorPage error={new Error("boom")} retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalled();
  });

  it("offers a way back to the portal home", () => {
    renderPage(<ErrorPage error={new Error("boom")} retry={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Back to portal home" })).toHaveAttribute("href", "/");
  });

  it("speaks French when the page is in French", () => {
    renderPage(<ErrorPage error={new Error("boom")} retry={vi.fn()} />, "fr");

    expect(screen.getByRole("alert")).toHaveTextContent("Un problème est survenu");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});
