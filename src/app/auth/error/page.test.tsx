import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthErrorPage, { metadata } from "./page";

// Auth.js sends sign-in failures here (pages.error) instead of its own
// unstyled page.
function renderWith(error?: string) {
  return AuthErrorPage({ searchParams: Promise.resolve(error ? { error } : {}) });
}

describe("AuthErrorPage", () => {
  it("is titled as a sign-in problem", () => {
    expect(metadata.title).toBe("Sign-in problem");
  });

  it("explains a server misconfiguration and points operators at the logs", async () => {
    render(await renderWith("Configuration"));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign-in didn’t work");
    expect(screen.getByText(/problem with the portal's setup/)).toBeInTheDocument();
    expect(screen.getByText(/logs/)).toBeInTheDocument();
  });

  it("explains a refusal", async () => {
    render(await renderWith("AccessDenied"));

    expect(screen.getByText(/PocketID didn't let you sign in/)).toBeInTheDocument();
  });

  it("falls back to a generic message and never shows the raw code", async () => {
    render(await renderWith("<script>alert(1)</script>"));

    expect(screen.getByText(/Something went wrong while signing you in/)).toBeInTheDocument();
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
  });

  it("offers a way back to try again", async () => {
    render(await renderWith());

    expect(screen.getByRole("link", { name: "Back to the sign-in page" })).toHaveAttribute("href", "/");
  });
});
