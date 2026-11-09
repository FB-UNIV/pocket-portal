import type { CatalogApp } from "./apps";

export type AppProblem = "no-link" | "no-description";

// What an admin should fix in PocketID before an app works well on the Apps
// page. No launch link: it can't be opened at all (and isn't listed). No
// description: people who don't know the app see only its name.
export function appProblems(app: Pick<CatalogApp, "launchUrl" | "description">): AppProblem[] {
  const problems: AppProblem[] = [];
  if (!app.launchUrl) problems.push("no-link");
  if (!app.description.trim()) problems.push("no-description");
  return problems;
}

