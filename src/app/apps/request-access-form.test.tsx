import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequestAccessForm } from "./request-access-form";
import type { RequestAccessResult } from "./actions";

function renderForm(
  result: RequestAccessResult,
  reason: "optional" | "required" | "off" = "optional",
) {
  const action = vi.fn().mockResolvedValue(result);
  render(
    <RequestAccessForm
      action={action}
      fieldId="message-c1-g1"
      friendlyName="Media"
      reason={reason}
    />,
  );
  return action;
}

describe("RequestAccessForm", () => {
  it("renders the reason field and a submit button named after the group", () => {
    renderForm({ ok: true });

    expect(screen.getByLabelText(/Reason for requesting Media/)).toHaveAttribute(
      "maxLength",
      "500",
    );
    expect(screen.getByRole("button", { name: "Request access via Media" })).toBeEnabled();
  });

  it("submits the typed reason to the action", async () => {
    const action = renderForm({ ok: true });

    await userEvent.type(screen.getByLabelText(/Reason for requesting Media/), "on call");
    await userEvent.click(screen.getByRole("button", { name: "Request access via Media" }));

    expect(action).toHaveBeenCalledTimes(1);
    const formData = action.mock.calls[0][1] as FormData;
    expect(formData.get("message")).toBe("on call");
  });

  it("says nothing extra once the request went through", async () => {
    renderForm({ ok: true });

    await userEvent.click(screen.getByRole("button", { name: "Request access via Media" }));

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  // A stale tab or a direct RPC call reaches these; they used to surface as an
  // opaque "Something went wrong" with a reference number.
  it.each([
    ["already_active", /already have a pending or approved request/],
    ["already_granted", /already have access through Media/],
    ["not_allowed", /can.t be requested for this app any more/],
    ["message_too_long", /500 characters or fewer/],
    ["reason_required", /Add a reason/],
    ["requests_disabled", /aren.t being taken/],
    ["rate_limited", /a lot of requests/],
  ] as const)("explains %s inline, in a live region", async (reason, text) => {
    renderForm({ ok: false, reason });

    await userEvent.click(screen.getByRole("button", { name: "Request access via Media" }));

    // The status region is always mounted, so wait for the text itself, then
    // check it landed inside the live region.
    expect(await screen.findByText(text)).toBe(screen.getByRole("status"));
  });

  // ACCESS_REQUEST_REASON.
  it("marks the reason as required when the deployment asks for one", () => {
    renderForm({ ok: true }, "required");

    const field = screen.getByLabelText(/Reason for requesting Media \(required\)/);
    expect(field).toBeRequired();
  });

  it("leaves the reason out entirely when it's switched off", () => {
    renderForm({ ok: true }, "off");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request access via Media" })).toBeEnabled();
  });
});
