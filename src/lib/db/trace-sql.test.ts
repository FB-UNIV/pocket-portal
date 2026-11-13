import { describe, it, expect, vi, afterEach } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { traceSql, describeStatement } from "./trace-sql";
import { recordSpans } from "@/test/otel";

afterEach(() => vi.restoreAllMocks());

// Enough of postgres.js for what drizzle calls: unsafe() returns a lazy
// query (it only runs when awaited) with .values(), and begin()/savepoint()
// hand a transaction client to a callback.
function fakeSql(fail?: Error & { code?: string }) {
  const ran: string[] = [];
  const query = (text: string) => {
    const q = {
      values: () => q,
      then(resolve: (rows: unknown) => unknown, reject: (err: unknown) => unknown) {
        ran.push(text);
        return (fail ? Promise.reject(fail) : Promise.resolve([["row"]])).then(resolve, reject);
      },
    };
    return q;
  };
  const make = (): Record<string, unknown> => ({
    unsafe: vi.fn((text: string) => query(text)),
    begin: vi.fn(async (cb: (tx: unknown) => unknown) => cb(make())),
    savepoint: vi.fn(async (cb: (tx: unknown) => unknown) => cb(make())),
    options: { max: 10 },
  });
  return { sql: make(), ran };
}

type Client = {
  unsafe: (text: string, params?: unknown[], options?: unknown) => PromiseLike<unknown> & { values(): PromiseLike<unknown> };
  begin: (cb: (tx: Client) => unknown) => Promise<unknown>;
  savepoint: (cb: (tx: Client) => unknown) => Promise<unknown>;
  options: unknown;
};

const SELECT = 'select "id", "status" from "access_requests" where "requester_email" = $1';

describe("traceSql", () => {
  it("gives every query a span named by its operation and table", async () => {
    const spans = recordSpans();
    const { sql } = fakeSql();
    const db = traceSql(sql) as unknown as Client;

    await expect(db.unsafe(SELECT, ["alice@example.test"])).resolves.toEqual([["row"]]);

    expect(spans).toEqual([
      expect.objectContaining({
        name: "SELECT access_requests",
        attributes: {
          "db.system.name": "postgresql",
          "db.operation.name": "SELECT",
          "db.collection.name": "access_requests",
          "db.query.text": SELECT,
        },
        ended: true,
      }),
    ]);
  });

  // Statement shape only: values are emails, subjects and request messages.
  it("never records a parameter value", async () => {
    const spans = recordSpans();
    const { sql } = fakeSql();

    await (traceSql(sql) as unknown as Client).unsafe(SELECT, ["alice@example.test"]);

    expect(JSON.stringify(spans)).not.toContain("alice@example.test");
  });

  it("traces drizzle's .values() form too, once, and only when it runs", async () => {
    const spans = recordSpans();
    const { sql, ran } = fakeSql();
    const db = traceSql(sql) as unknown as Client;

    const pending = db.unsafe(SELECT, []).values();
    expect(spans).toHaveLength(0);
    expect(ran).toHaveLength(0);

    await expect(pending).resolves.toEqual([["row"]]);
    expect(spans).toHaveLength(1);
    expect(ran).toEqual([SELECT]);
  });

  // A database error message can quote a value (e.g. a unique violation's
  // detail), so the span keeps the error's code, not its text.
  it("marks a failed query, keeping the error code but not its message", async () => {
    const spans = recordSpans();
    const err = Object.assign(new Error('duplicate key value: "alice@example.test"'), { code: "23505" });
    const { sql } = fakeSql(err);

    await expect((traceSql(sql) as unknown as Client).unsafe(SELECT, [])).rejects.toBe(err);

    expect(spans[0]).toMatchObject({
      status: { code: SpanStatusCode.ERROR },
      attributes: expect.objectContaining({ "error.type": "23505" }),
      ended: true,
    });
    expect(JSON.stringify(spans)).not.toContain("alice@example.test");
  });

  it("traces queries inside a transaction and a savepoint", async () => {
    const spans = recordSpans();
    const { sql } = fakeSql();
    const db = traceSql(sql) as unknown as Client;

    await db.begin(async (tx) => {
      await tx.unsafe('insert into "audit_log" ("action") values ($1)', ["x"]);
      await tx.savepoint(async (sp) => {
        await sp.unsafe('update "access_requests" set "status" = $1', ["approved"]);
      });
    });

    expect(spans.map((s) => s.name)).toEqual(["INSERT audit_log", "UPDATE access_requests"]);
  });

  it("leaves everything else on the client alone", () => {
    const { sql } = fakeSql();

    expect((traceSql(sql) as unknown as Client).options).toEqual({ max: 10 });
  });
});

describe("describeStatement", () => {
  it.each([
    ['select "id" from "app_overrides" where "id" = $1', "SELECT", "app_overrides"],
    ['insert into "audit_log" ("action") values ($1)', "INSERT", "audit_log"],
    ['update "access_requests" set "status" = $1', "UPDATE", "access_requests"],
    ['delete from "session_claims" where "subject" = $1', "DELETE", "session_claims"],
    ["  SELECT count(*) FROM public.audit_log", "SELECT", "audit_log"],
    ["set local statement_timeout = 2000", "SET", undefined],
    ["select 1", "SELECT", undefined],
  ])("%s", (text, operation, table) => {
    expect(describeStatement(text)).toEqual({ operation, table });
  });
});
