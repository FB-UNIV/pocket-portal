import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorPage from "./error";

describe("ErrorPage", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("announces the failure to assistive technology", () => {
    render(<ErrorPage error={new Error("boom")} retry={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
  });

  // The server actions behind this app throw messages that can name another
  // user's groups or requests; the boundary is rendered client-side, so it
  // shows a generic message and only the digest an operator can grep for.
  it("does not render the raw error message", () => {
    render(
      <ErrorPage error={Object.assign(new Error("boom"), { digest: "abc123" })} retry={vi.fn()} />,
    );

    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("offers a retry that re-renders the segment", async () => {
    const retry = vi.fn();
    render(<ErrorPage error={new Error("boom")} retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalled();
  });

  it("offers a way back to the portal home", () => {
    render(<ErrorPage error={new Error("boom")} retry={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Back to portal home" })).toHaveAttribute("href", "/");
  });
});
