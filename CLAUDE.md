# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run dev server (with hot reload)
npm run dev

# Run production server
npm start

# Generate Prisma client after schema changes
npx prisma generate

# Run a migration
npx prisma migrate dev --name <migration-name>

# Apply migrations to production
npx prisma migrate deploy
```

There is no test suite or lint script configured.

## Architecture

This is an Express 5 + TypeScript REST API backend for the TurfRank platform. It uses ESM (`"type": "module"`) and runs directly via `tsx` without a build step.

**Key files:**
- `src/app.ts` — Express app entry point; mounts all routes
- `src/db.ts` — Single `prisma` export used by all controllers; connects via `pg` pool through `@prisma/adapter-pg`
- `src/routes/index.ts` — Root router that mounts all sub-routers
- `src/middleware/auth.middleware.ts` — `requireAuth` middleware; verifies JWT and attaches `req.auth.userId`
- `src/types/express.d.ts` — Extends Express `Request` with `auth?: { userId: string }`

**Request flow:**
`app.ts` → `routes/index.ts` → route files → controller functions

Controllers directly import `prisma` from `src/db.ts` and handle all DB interaction. There is no service layer.

**Prisma setup:**
- Schema: `prisma/schema.prisma`
- Generated client output: `generated/prisma/` (not the default location — always import from `../../generated/prisma/client.js`)
- Config: `prisma.config.ts` (uses `dotenv/config` to load `DATABASE_URL`)

## Data models

- **User** — authenticated via phone number + OTP; soft-deleted via `isDeleted`
- **Otp** — short-lived (10 min TTL), single-use codes for phone auth
- **Sport** — reference data; `isActive` flag
- **City** — reference data keyed by Google `placeId`
- **Venue** — belongs to a City
- **Tournament** — belongs to Venue, Sport, and organiser (User); `TournamentStatus` enum: `PUBLISHED | LIVE | CANCELLED | COMPLETED`; soft-deleted via `isDeleted`
- **TournamentContact** — join table between Tournament and User; soft-deleted via `isDeleted`; unique on `(tournamentId, userId)`

## Auth flow

1. `POST /login` — accepts `phoneNumber`, creates user if new, creates OTP record (invalidates prior active OTPs), returns OTP in response (dev mode — no SMS integration)
2. `POST /verify-otp` — accepts `phoneNumber` + `otp`, marks OTP used, returns JWT signed with `JWT_SECRET`
3. All protected routes use `requireAuth` middleware; JWT carries `sub` = `userId`

## API routes

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/login` | No | |
| POST | `/verify-otp` | No | |
| GET | `/profile` | Yes | |
| PATCH | `/profile` | Yes | |
| GET | `/profile/search?phone=` | No | |
| GET/POST | `/sports` | GET public | |
| GET/PATCH/DELETE | `/sports/:id` | PATCH/DELETE protected | |
| POST | `/venues` | Yes | |
| GET | `/venues/search` | No | geo-search by lat/lng radius |
| POST | `/cities` | No | |
| GET/POST | `/tournaments` | GET public | |
| GET/PATCH/DELETE | `/tournaments/:id` | PATCH/DELETE protected | |

## Tournament contacts

Contacts can be provided as either a `userId` (existing user UUID) or `{ name, phone }` (auto-upserts a user by phone number). On create, contacts are created fresh. On update, providing `contacts` replaces the full set (soft-deletes existing, upserts new). `sportId` cannot be changed after creation.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (Neon-hosted, pooled endpoint) |
| `JWT_SECRET` | Secret for signing/verifying JWTs |
| `JWT_EXPIRES_IN` | JWT expiry (default `"7d"`) |
| `PORT` | Server port (default `8080`) |

## TypeScript conventions

- **Never use `any`, `unknown`, or `as` casts.** Use specific types, type guards, or typed variable declarations instead. (`as const` is fine.)
- `strict: true` is enabled; all controller functions return `Promise<void>` and handle errors internally
- All imports use `.js` extensions (required for NodeNext ESM resolution)
- Enums and Prisma types are imported from `../../generated/prisma/client.js`
