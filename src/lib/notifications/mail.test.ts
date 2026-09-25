import { describe, it, expect, vi } from "vitest";
import { readMailConfig, sendMail } from "./mail";

const sendMailMock = vi.fn();
const createTransport = vi.fn<(options: unknown) => { sendMail: typeof sendMailMock }>(() => ({
  sendMail: sendMailMock,
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: (options: unknown) => createTransport(options) },
}));

describe("readMailConfig", () => {
  it("is off when SMTP_HOST is unset", () => {
    expect(readMailConfig({})).toBeNull();
    expect(readMailConfig({ SMTP_HOST: "" })).toBeNull();
  });

  it("defaults to STARTTLS on 587, unauthenticated", () => {
    expect(readMailConfig({ SMTP_HOST: "smtp.example.test", SMTP_FROM: "portal@example.test" })).toEqual({
      host: "smtp.example.test",
      port: 587,
      tls: "starttls",
      auth: undefined,
      from: "portal@example.test",
    });
  });

  it("defaults implicit TLS to 465 and reads credentials", () => {
    expect(
      readMailConfig({
        SMTP_HOST: "smtp.example.test",
        SMTP_FROM: "portal@example.test",
        SMTP_TLS: "tls",
        SMTP_USER: "portal",
        SMTP_PASSWORD: "secret",
      }),
    ).toMatchObject({ port: 465, tls: "tls", auth: { user: "portal", pass: "secret" } });
  });

  it("honours an explicit port", () => {
    expect(
      readMailConfig({ SMTP_HOST: "mail", SMTP_FROM: "a@b.test", SMTP_PORT: "25", SMTP_TLS: "none" }),
    ).toMatchObject({ port: 25, tls: "none" });
  });

  // A half-configured mailer should say so, not send from nobody.
  it.each([
    ["SMTP_FROM is missing", { SMTP_HOST: "mail" }, /SMTP_FROM/],
    ["SMTP_TLS is unknown", { SMTP_HOST: "mail", SMTP_FROM: "a@b.test", SMTP_TLS: "ssl" }, /SMTP_TLS/],
    ["SMTP_PORT isn't a port", { SMTP_HOST: "mail", SMTP_FROM: "a@b.test", SMTP_PORT: "nope" }, /SMTP_PORT/],
    ["only SMTP_USER is set", { SMTP_HOST: "mail", SMTP_FROM: "a@b.test", SMTP_USER: "u" }, /SMTP_PASSWORD/],
  ])("throws when %s", (_why, env, message) => {
    expect(() => readMailConfig(env)).toThrow(message);
  });
});

describe("sendMail", () => {
  it("maps the TLS mode onto nodemailer and sends plain text", async () => {
    sendMailMock.mockResolvedValue({});
    const config = readMailConfig({
      SMTP_HOST: "smtp.example.test",
      SMTP_FROM: "portal@example.test",
      SMTP_USER: "u",
      SMTP_PASSWORD: "p",
    })!;

    await sendMail(config, { to: ["a@example.test"], subject: "Hi", text: "Body" });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "u", pass: "p" },
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "portal@example.test",
      to: ["a@example.test"],
      subject: "Hi",
      text: "Body",
    });
  });

  it.each([
    ["tls", { secure: true, requireTLS: false }],
    ["none", { secure: false, requireTLS: false }],
  ] as const)("uses %s as asked", async (tls, expected) => {
    sendMailMock.mockResolvedValue({});

    await sendMail(
      { host: "mail", port: 1, tls, from: "a@b.test", auth: undefined },
      { to: ["x@y.test"], subject: "s", text: "t" },
    );

    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining(expected));
  });
});
