import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequestAccessForm, type RoleOption } from "./request-access-form";
import type { RequestAccessResult } from "./actions";

const USERS = { id: "g-users", friendlyName: "Sonarr users" };
const ADMINS = { id: "g-admins", friendlyName: "Sonarr admins" };
const ASK = { name: "Ask for access to Sonarr" };

function renderForm({
  result = { ok: true },
  reason = "optional",
  roles = [USERS],
  defaultRoleId = roles[0].id,
}: {
  result?: RequestAccessResult;
  reason?: "optional" | "required" | "off";
  roles?: RoleOption[];
  defaultRoleId?: string;
} = {}) {
  const action = vi.fn().mockResolvedValue(result);
  render(
    <RequestAccessForm
      action={action}
      appId="c1"
      appName="Sonarr"
      roles={roles}
      defaultRoleId={defaultRoleId}
      reason={reason}
    />,
  );
  return action;
}

function submitted(action: ReturnType<typeof vi.fn>): FormData {
  expect(action).toHaveBeenCalledTimes(1);
  return action.mock.calls[0][1] as FormData;
}

describe("RequestAccessForm", () => {
  // SC 2.5.3 / 2.4.6: one button per card, its name says which app.
  it("has one Ask for access button that names the app", () => {
    renderForm();

    const button = screen.getByRole("button", ASK);
    expect(button).toHaveTextContent("Ask for access");
    expect(button).toBeEnabled();
  });

  it("shows no role picker when there's only one role, and sends that role", async () => {
    const action = renderForm();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", ASK));

    expect(submitted(action).get("group")).toBe("g-users");
  });

  it("lets you pick a role when there are several, starting on the default", async () => {
    const action = renderForm({ roles: [ADMINS, USERS], defaultRoleId: "g-users" });

    const picker = screen.getByRole("combobox", { name: "Role" });
    expect(picker).toHaveValue("g-users");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Sonarr admins",
      "Sonarr users",
    ]);

    await userEvent.selectOptions(picker, "g-admins");
    await userEvent.click(screen.getByRole("button", ASK));

    expect(submitted(action).get("group")).toBe("g-admins");
  });

  it("submits the typed reason with the role", async () => {
    const action = renderForm();

    await userEvent.type(screen.getByLabelText(/Why do you need it\?/), "on call");
    await userEvent.click(screen.getByRole("button", ASK));

    const form = submitted(action);
    expect(form.get("message")).toBe("on call");
    expect(form.get("group")).toBe("g-users");
  });

  it("caps the reason at 500 characters", () => {
    renderForm();

    expect(screen.getByLabelText(/Why do you need it\?/)).toHaveAttribute("maxLength", "500");
  });

  it("says nothing extra once the request went through", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", ASK));

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  // A stale tab or a direct RPC call reaches these; they used to surface as an
  // opaque "Something went wrong" with a reference number.
  it.each([
    ["already_active", /already asked for this role/],
    ["already_granted", /already have this role/],
    ["not_allowed", /can.t be requested for this app any more/],
    ["message_too_long", /500 characters or fewer/],
    ["reason_required", /Add a reason/],
    ["requests_disabled", /aren.t being taken/],
    ["rate_limited", /a lot of requests/],
  ] as const)("explains %s inline, in a live region", async (reason, text) => {
    renderForm({ result: { ok: false, reason } });

    await userEvent.click(screen.getByRole("button", ASK));

    // The status region is always mounted, so wait for the text itself, then
    // check it landed inside the live region.
    expect(await screen.findByText(text)).toBe(screen.getByRole("status"));
  });

  // ACCESS_REQUEST_REASON.
  it("marks the reason as required when the deployment asks for one", () => {
    renderForm({ reason: "required" });

    expect(screen.getByLabelText(/Why do you need it\? \(required\)/)).toBeRequired();
  });

  it("leaves the reason out entirely when it's switched off", () => {
    renderForm({ reason: "off" });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", ASK)).toBeEnabled();
  });
});
