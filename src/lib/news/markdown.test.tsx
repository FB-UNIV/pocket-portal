import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown, safeHref } from "./markdown";

// #22: news posts are Markdown, rendered on the server into React elements.
// Never an HTML string: React escapes all text, so raw HTML can't exist, and
// links are allow-listed. A subset, enough for announcements.
const html = (md: string) => renderToStaticMarkup(<>{renderMarkdown(md)}</>);

describe("renderMarkdown", () => {
  it("splits paragraphs on blank lines, and keeps line breaks inside one", () => {
    expect(html("Maintenance tonight.\nBack by 10.\n\nThanks!")).toBe(
      "<p>Maintenance tonight.<br/>Back by 10.</p><p>Thanks!</p>",
    );
  });

  it("renders headings as subheadings of the post", () => {
    expect(html("## What changes\nText")).toBe("<h4>What changes</h4><p>Text</p>");
  });

  it("renders bullet and numbered lists", () => {
    expect(html("- Grafana\n* Prometheus")).toBe("<ul><li>Grafana</li><li>Prometheus</li></ul>");
    expect(html("1. Sign in\n2. Open it")).toBe("<ol><li>Sign in</li><li>Open it</li></ol>");
  });

  it("renders bold, italic and code", () => {
    expect(html("**Grafana** is *down* for `upgrade`")).toBe(
      "<p><strong>Grafana</strong> is <em>down</em> for <code>upgrade</code></p>",
    );
  });

  it("renders safe links", () => {
    expect(html("See [the apps](/apps) or [status](https://status.example.test).")).toBe(
      '<p>See <a href="/apps">the apps</a> or <a href="https://status.example.test" rel="noreferrer">status</a>.</p>',
    );
  });

  // The point of rendering to React elements: nothing an admin types can
  // become markup.
  it.each([
    ["<script>alert(1)</script>", "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"],
    ['<img src=x onerror="alert(1)">', "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>"],
    ["**<b>bold</b>**", "<p><strong>&lt;b&gt;bold&lt;/b&gt;</strong></p>"],
  ])("never lets HTML through: %s", (md, expected) => {
    expect(html(md)).toBe(expected);
  });

  it.each([
    "[x](javascript:alert(1))",
    "[x](JavaScript:alert(1))",
    "[x]( javascript:alert(1))",
    "[x](data:text/html;base64,PHNjcmlwdD4=)",
    "[x](vbscript:msgbox)",
    "[x](//evil.example.test)",
    "[x](/\\evil.example.test)",
  ])("never renders an unsafe link: %s", (md) => {
    expect(html(md)).not.toContain("<a");
    expect(html(md)).not.toMatch(/href/);
  });

  it("leaves text that only looks like markup alone", () => {
    expect(html("2 * 3 * 4 and a_b_c")).toBe("<p>2 * 3 * 4 and a_b_c</p>");
  });

  it("is empty for an empty body", () => {
    expect(html("   \n\n  ")).toBe("");
  });
});

describe("safeHref", () => {
  it.each([
    ["/apps", "/apps"],
    ["https://x.example.test/a?b=1", "https://x.example.test/a?b=1"],
    ["http://x.example.test", "http://x.example.test"],
    ["mailto:it@example.test", "mailto:it@example.test"],
  ])("allows %s", (href, expected) => {
    expect(safeHref(href)).toBe(expected);
  });

  it.each(["javascript:x", "data:x", "//x.test", "/\\x.test", "ftp://x.test", "", "apps"])("refuses %j", (href) => {
    expect(safeHref(href)).toBeNull();
  });
});
