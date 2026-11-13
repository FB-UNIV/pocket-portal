import { defineConfig } from "vitepress";

// The docs site (#8): docs/ rendered as is, from this repository, on every
// merge to main (.github/workflows/docs.yml). The files stay where the code
// links to them and tests read them; the site only renders them. Its own
// package (docs/package.json), so its tooling never touches the app's
// dependencies, image or SBOM.
export default defineConfig({
  title: "pocket-portal",
  description: "A self-hosted portal in front of PocketID: the apps people can open, and asking for the rest.",
  // Served from https://<owner>.github.io/pocket-portal/.
  base: "/pocket-portal/",
  cleanUrls: true,
  lastUpdated: true,
  rewrites: {
    "RUNBOOK.md": "deploy.md",
    "ARCHITECTURE.md": "architecture.md",
    "DEVELOPMENT.md": "develop.md",
    "CONTRIBUTING.md": "contributing.md",
    "CI.md": "ci.md",
    "DESIGN.md": "design.md",
    "adr/README.md": "adr/index.md",
  },
  // Links that leave docs/ (to source files, the README, .claude/rules)
  // point into the repository, not the site; localhost is a dev address.
  ignoreDeadLinks: [/^\.\.\//, /^\.\/\.\.\//, /^https?:\/\/localhost\b/],
  // An inline PostCSS config, so Vite doesn't walk up to the app's own
  // (postcss.config.mjs, Tailwind), which this package doesn't install.
  vite: { css: { postcss: {} } },
  markdown: {
    // These are plain Markdown files, also read on GitHub: inline code such
    // as `{{json .SBOM}}` or `${{ github.ref }}` is text, never a Vue
    // expression (fenced code already is). `v-pre` makes Vue skip it.
    config(md) {
      const render = md.renderer.rules.code_inline!;
      md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
        tokens[idx].attrSet("v-pre", "");
        return render(tokens, idx, options, env, self);
      };
    },
  },
  themeConfig: {
    search: { provider: "local" },
    nav: [
      { text: "Deploy", link: "/deploy" },
      { text: "Configure", link: "/configuration" },
      { text: "Develop", link: "/develop" },
      { text: "Architecture", link: "/architecture" },
    ],
    sidebar: [
      { text: "Deploy", items: [{ text: "Runbook", link: "/deploy" }] },
      { text: "Configure", items: [{ text: "Settings", link: "/configuration" }] },
      {
        text: "Develop",
        items: [
          { text: "Development", link: "/develop" },
          { text: "Contributing", link: "/contributing" },
          { text: "CI", link: "/ci" },
          { text: "Design", link: "/design" },
        ],
      },
      {
        text: "Architecture & decisions",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Decision records", link: "/adr/" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/FB-UNIV/pocket-portal" }],
    editLink: { pattern: "https://github.com/FB-UNIV/pocket-portal/edit/main/docs/:path" },
  },
});
