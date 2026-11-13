import type { ReactNode } from "react";

// News posts' Markdown (#22), rendered on the server into React elements,
// never into an HTML string: React escapes every piece of text, so raw HTML
// in a post stays text, and no dangerouslySetInnerHTML is needed. Links are
// allow-listed (safeHref). A deliberate subset, enough for announcements:
//
//   paragraphs (blank line between), line breaks, "# heading",
//   "- item" / "1. item" lists, **bold**, *italic* or _italic_, `code`,
//   [text](https://… or /path or mailto:…)
//
// Anything else is shown as typed.

// Where a link may go: http(s), mailto, or a path on this site. Not
// javascript:/data:/vbscript:, and not "//host" or "/\host", which
// browsers treat as another site.
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      return url.protocol === "http:" || url.protocol === "https:" ? href : null;
    } catch {
      return null;
    }
  }
  if (/^mailto:[^\s]+$/i.test(href)) return href;
  if (/^\/(?![/\\])/.test(href)) return href;
  return null;
}

// The earliest inline construct in `text`, as [match, kind]; code first so
// its contents are never read as anything else.
const INLINE: [RegExp, "code" | "link" | "strong" | "em"][] = [
  [/`([^`\n]+)`/, "code"],
  [/\[([^\]\n]+)\]\(([^)\n]*)\)/, "link"],
  [/\*\*([^*\n]+?)\*\*/, "strong"],
  [/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/, "em"],
  [/(?<![\w_])_(?!\s)([^_\n]+?)_(?![\w_])/, "em"],
];

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { match: RegExpExecArray; kind: (typeof INLINE)[number][1] } | null = null;
    for (const [pattern, kind] of INLINE) {
      const match = pattern.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { match, kind };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { match, kind } = best;
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const k = `${key}-${n++}`;
    if (kind === "code") out.push(<code key={k}>{match[1]}</code>);
    else if (kind === "strong") out.push(<strong key={k}>{inline(match[1], k)}</strong>);
    else if (kind === "em") out.push(<em key={k}>{inline(match[1], k)}</em>);
    else {
      const href = safeHref(match[2]);
      const label = inline(match[1], k);
      if (!href) out.push(...label);
      else if (/^https?:/i.test(href)) {
        out.push(
          <a key={k} href={href} rel="noreferrer">
            {label}
          </a>,
        );
      } else {
        out.push(
          <a key={k} href={href}>
            {label}
          </a>,
        );
      }
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;

function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  // In an object, so the type checker follows close() resetting it.
  const open: { block: Block | null } = { block: null };
  const close = () => {
    if (open.block) out.push(open.block);
    open.block = null;
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      close();
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (heading) {
      close();
      out.push({ kind: "h", text: heading[1] });
    } else if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const text = (bullet ?? numbered)![1];
      if (open.block?.kind !== kind) {
        close();
        open.block = { kind, items: [] };
      }
      (open.block as { items: string[] }).items.push(text);
    } else {
      if (open.block?.kind !== "p") {
        close();
        open.block = { kind: "p", lines: [] };
      }
      (open.block as { lines: string[] }).lines.push(line.trim());
    }
  }
  close();
  return out;
}

export function renderMarkdown(markdown: string): ReactNode[] {
  return blocks(markdown).map((block, b) => {
    const key = `b${b}`;
    if (block.kind === "h") return <h4 key={key}>{inline(block.text, key)}</h4>;
    if (block.kind === "ul" || block.kind === "ol") {
      const List = block.kind;
      return (
        <List key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item, `${key}-${i}`)}</li>
          ))}
        </List>
      );
    }
    return (
      <p key={key}>
        {block.lines.flatMap((line, i) =>
          i === 0 ? inline(line, `${key}-${i}`) : [<br key={`${key}-br${i}`} />, ...inline(line, `${key}-${i}`)],
        )}
      </p>
    );
  });
}
