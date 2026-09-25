# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Minimal runtime image: only the standalone server output + static assets.
# Alpine base (not slim/Debian): far fewer OS-level CVEs to carry, and this
# app has no native (glibc-only) dependencies to worry about. All stages use
# the same base to avoid musl/glibc ABI mismatches for any compiled deps.
# Stateless (see .claude/rules/pocketid-api.md): no volumes, no local
# persistence — safe to run any number of replicas behind a load balancer.
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Don't trust the base image tag's package versions as of build time — apk
# upgrade picks up patched packages (e.g. openssl CVEs) without waiting for
# node:24-alpine itself to be rebuilt upstream.
RUN apk update && apk upgrade --no-cache
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations run from this image: the SQL files plus the runner, which
# uses drizzle-orm's migrator (a production dependency already traced into
# the standalone bundle via next.config.ts) rather than drizzle-kit — so no
# npm, npx or devDependencies are needed at runtime. The layout deliberately
# mirrors the repo (scripts/migrate.mjs resolves ../drizzle) so the same
# script works from a checkout and from here.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --chown=nextjs:nodejs scripts/migrate.mjs ./scripts/migrate.mjs

# migrate.mjs runs outside the Next bundle, so it needs these two as real,
# resolvable packages. Next bundles both into the server chunks and emits
# neither into the standalone node_modules, and file tracing can only force
# in loose files (no package.json => the import still fails) — so they are
# copied wholesale. Costs ~17MB of a ~218MB image, and adds no new supply
# chain: both are already production dependencies bundled into the server.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# The base image bundles a global npm/npx/corepack install we never use at
# runtime (we only run `node server.js`) — drop it rather than carry its CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Liveness only (/api/health touches no dependency). node, because the
# runtime image has no curl or wget.
#
# start-period covers migrations, since the server listens only after them:
# up to 60s waiting for another replica's advisory lock (LOCK_TIMEOUT_MS in
# scripts/migrate.mjs), plus the migration itself.
HEALTHCHECK --interval=30s --timeout=3s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
