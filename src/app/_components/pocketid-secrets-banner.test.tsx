import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PocketIdSecretsBanner } from "./pocketid-secrets-banner";
import { getSecretExposure } from "@/lib/pocketid/secret-exposure";

vi.mock("@/lib/pocketid/secret-exposure", () => ({ getSecretExposure: vi.fn() }));

const mockExposure = vi.mocked(getSecretExposure);

describe("PocketIdSecretsBanner", () => {
  beforeEach(() => {
    mockExposure.mockReset();
    vi.stubEnv("POCKETID_BASE_URL", "https://id.example.test");
  });

  it("warns admins, naming the fix, when PocketID secrets are readable", async () => {
    mockExposure.mockResolvedValue("readable");

    render(await PocketIdSecretsBanner());

    const region = screen.getByRole("region", { name: "Security warning" });
    expect(region).toHaveTextContent(/UI_CONFIG_DISABLED=true/);
    expect(screen.getByRole("link", { name: /securing the portal/i })).toHaveAttribute(
      "href",
      expect.stringContaining("#securing-the-portal"),
    );
  });

  it.each(["masked", "unknown"] as const)("renders nothing when exposure is %s", async (state) => {
    mockExposure.mockResolvedValue(state);

    const { container } = render(<>{await PocketIdSecretsBanner()}</>);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a configured PocketID", async () => {
    vi.stubEnv("POCKETID_BASE_URL", "");

    const { container } = render(<>{await PocketIdSecretsBanner()}</>);

    expect(container).toBeEmptyDOMElement();
    expect(mockExposure).not.toHaveBeenCalled();
  });

  // a deployer who has accepted the risk can hide the banner; the
  // startup log line still records it.
  it("stays hidden while WARN_POCKETID_SECRETS_READABLE is off", async () => {
    vi.stubEnv("WARN_POCKETID_SECRETS_READABLE", "false");
    mockExposure.mockResolvedValue("readable");

    expect(await PocketIdSecretsBanner()).toBeNull();
    expect(mockExposure).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
