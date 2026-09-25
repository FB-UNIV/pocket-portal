// Liveness: "is this process serving", nothing more. It touches neither
// Postgres nor PocketID, so a dependency outage can't make an orchestrator
// restart healthy instances; /api/ready is what reacts to dependencies. As
// a route handler it skips the root layout's auth(), so it answers with no
// configuration at all.
export async function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
