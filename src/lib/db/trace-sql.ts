import { withSpan } from "@/lib/observability/tracing";

// Database spans (#16). postgres.js has no OpenTelemetry instrumentation,
// and drizzle's built-in tracer is inert in the version we run (it never
// loads the API), so without this a request's trace has a gap wherever it
// waited on Postgres.
//
// Each query gets a span named "<OPERATION> <table>" carrying the
// statement as drizzle builds it, with `$1` placeholders: the statement's
// shape, never a parameter value (emails, subjects, request messages). A
// failure is recorded by its Postgres error code only, since an error's
// text can quote a value (e.g. a unique violation's detail).

export interface StatementShape {
  operation: string;
  table: string | undefined;
}

const TABLE = /\b(?:from|into|update)\s+(?:"?\w+"?\.)?"?(\w+)"?/i;

export function describeStatement(text: string): StatementShape {
  const trimmed = text.trim();
  const operation = (trimmed.match(/^\w+/)?.[0] ?? "QUERY").toUpperCase();
  return { operation, table: trimmed.match(TABLE)?.[1] };
}

// What drizzle uses of a postgres.js client: `unsafe(text, params,
// options)` returns a lazy query (it runs when awaited) with `.values()`;
// `begin`/`savepoint` hand a transaction client to a callback.
type LazyQuery = PromiseLike<unknown> & { values(): LazyQuery };
type Callback = (client: unknown) => unknown;

function traced(query: LazyQuery, text: string): LazyQuery {
  const { operation, table } = describeStatement(text);
  return {
    // drizzle calls .values() right after unsafe(), before awaiting: still
    // the same, not-yet-run query, so still one span.
    values: () => traced(query.values(), text),
    then(onFulfilled, onRejected) {
      return withSpan(
        table ? `${operation} ${table}` : operation,
        {
          "db.system.name": "postgresql",
          "db.operation.name": operation,
          ...(table ? { "db.collection.name": table } : {}),
          "db.query.text": text,
        },
        async () => await query,
        { errorDetail: "type" },
      ).then(onFulfilled, onRejected);
    },
  };
}

// Wraps a postgres.js client so every query drizzle runs through it, in or
// out of a transaction, is traced. Everything else passes straight through.
export function traceSql<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      if (prop === "unsafe") {
        return (text: string, ...rest: unknown[]) => traced(value.call(target, text, ...rest), text);
      }
      if (prop === "begin" || prop === "savepoint") {
        // The callback is last; begin() also takes an optional options string.
        return (...args: unknown[]) => {
          const callback = args.at(-1) as Callback;
          return value.call(target, ...args.slice(0, -1), (tx: object) => callback(traceSql(tx)));
        };
      }
      return value.bind(target);
    },
  });
}
