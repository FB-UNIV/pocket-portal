import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "./not-found";
import { setTestLocale } from "@/test/intl";

describe("NotFound", async () => {
  it("explains what happened under a top-level heading", async () => {
    render(await NotFound());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
  });

  it("offers a way back to the portal home", async () => {
    render(await NotFound());

    expect(screen.getByRole("link", { name: "Back to portal home" })).toHaveAttribute("href", "/");
  });

  it("speaks French when the page is in French", async () => {
    setTestLocale("fr");
    render(await NotFound());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page introuvable");
    expect(screen.getByRole("link", { name: "Retour à l’accueil du portail" })).toHaveAttribute("href", "/");
  });
});
