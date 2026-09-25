import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "./not-found";

describe("NotFound", () => {
  it("explains what happened under a top-level heading", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
  });

  it("offers a way back to the portal home", () => {
    render(<NotFound />);

    expect(screen.getByRole("link", { name: "Back to portal home" })).toHaveAttribute("href", "/");
  });
});
