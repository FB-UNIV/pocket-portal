import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy, originOf } from "@/lib/security/csp";
import { readPocketIdBaseUrl } from "@/lib/config";

// Sets the Content-Security-Policy with a fresh nonce per request, as
// Next's CSP guide prescribes: Next reads the nonce from the request's CSP
// header and puts it on its own scripts. Runs on Node, in the same process
// as instrumentation, so it sees settings the config file supplied.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy({
    nonce,
    pocketIdOrigin: originOf(readPocketIdBaseUrl()),
    dev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Pages only: API routes return JSON, static assets need no CSP, and
    // prefetches are skipped as Next's guide recommends.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
