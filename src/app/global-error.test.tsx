import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GlobalError from "./global-error";

// error.tsx sits *inside* the root layout, so it cannot catch a root-layout
// failure — and the layout now calls auth() on every route, which throws
// when PocketID is unreachable. global-error.tsx is the only boundary that
// covers that, and it replaces the document, so it ships its own markup.
describe("GlobalError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("announces the failure to assistive technology", () => {
    render(<GlobalError error={new Error("boom")} retry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i);
  });

  it("does not render the raw error message", () => {
    render(
      <GlobalError
        error={Object.assign(new Error("boom"), { digest: "abc123" })}
        retry={vi.fn()}
      />,
    );

    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("offers a retry", async () => {
    const retry = vi.fn();
    render(<GlobalError error={new Error("boom")} retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalled();
  });

  // A plain anchor, not next/link: the root layout is what failed, so a full
  // document load is the recovery, not a client-side transition.
  it("offers a full reload back to the portal home", () => {
    render(<GlobalError error={new Error("boom")} retry={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Back to portal home" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  // Next replaces the whole document here, so global styles never load and
  // the page must carry its own — including the dark-scheme pair.
  it("ships its own styles, since the root layout's never load", () => {
    const { container } = render(<GlobalError error={new Error("boom")} retry={vi.fn()} />);

    const style = container.querySelector("style");
    expect(style?.textContent).toMatch(/prefers-color-scheme: dark/);
  });
});
