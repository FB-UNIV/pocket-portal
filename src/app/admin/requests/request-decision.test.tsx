import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequestDecision } from "./request-decision";
import type { DecideAccessRequestResult } from "./actions";

function renderDecision(
  approveResult: DecideAccessRequestResult | null,
  denyResult: DecideAccessRequestResult = { ok: true },
) {
  const approveAction = vi.fn().mockResolvedValue(approveResult);
  const denyAction = vi.fn().mockResolvedValue(denyResult);
  render(
    <RequestDecision
      approveAction={approveResult ? approveAction : undefined}
      denyAction={denyAction}
      requester="alice@example.test"
      groupName="media"
    />,
  );
  return { approveAction, denyAction };
}

describe("RequestDecision", () => {
  it("names each button after the request it decides", () => {
    renderDecision({ ok: true });

    expect(
      screen.getByRole("button", { name: "Approve alice@example.test for media" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deny alice@example.test for media" })).toBeEnabled();
  });

  it("submits approve and deny to their own actions", async () => {
    const { approveAction, denyAction } = renderDecision({ ok: true });

    await userEvent.click(screen.getByRole("button", { name: /^Approve/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Deny/ }));

    expect(approveAction).toHaveBeenCalledTimes(1);
    expect(denyAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  // A stale page reaches this: the app was hidden or its group removed after
  // the queue rendered. It used to surface as "Something went wrong".
  it("explains a refused approval inline, in a live region", async () => {
    renderDecision({ ok: false, reason: "group_not_grantable" });

    await userEvent.click(screen.getByRole("button", { name: /^Approve/ }));

    expect(await screen.findByText(/can.t be granted for this app any more/)).toBe(
      screen.getByRole("status"),
    );
  });

  it("offers only Deny, with the reason, when no approve action is given", () => {
    renderDecision(null);

    expect(screen.queryByRole("button", { name: /^Approve/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Deny/ })).toBeEnabled();
    expect(screen.getByText(/can.t be approved/i)).toBeInTheDocument();
  });
});
