-- Better Auth schema for Neon Postgres. Applied by `npm run db:setup`.
--
-- Idempotent: tables and indexes use IF NOT EXISTS, functions use CREATE OR
-- REPLACE, triggers are dropped and re-created. Re-running it is safe, but it
-- only CREATES missing objects: changing a column here does not alter a table
-- that already exists. Existing databases need a separate ALTER TABLE.
--
-- Conventions:
-- - TEXT for every string except ids. Postgres stores TEXT and VARCHAR(n) the
--   same way, and several values come from request headers or OAuth providers
--   (User-Agent, IP address, rate-limit keys, tokens, sign-in state), so a
--   length limit would turn an unusual header into a failed insert.
-- - TIMESTAMPTZ for every timestamp. node-postgres reads and writes plain
--   TIMESTAMP in the Node process's local time zone, while the defaults and
--   triggers below use the database's clock (UTC on Neon).

-- --------------------------------------------------------------------------------------
-- 1. TABLES
-- --------------------------------------------------------------------------------------

-- Users. firstName/lastName are required at sign-up (user.additionalFields in
-- lib/auth.ts); the trigger in section 3 keeps "name" in sync with them.
CREATE TABLE IF NOT EXISTS "user" (
	id VARCHAR(36) NOT NULL PRIMARY KEY,
	"name" TEXT NOT NULL,
	"firstName" TEXT NOT NULL,
	"lastName" TEXT NOT NULL,
	"email" TEXT NOT NULL UNIQUE,
	"emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
	"image" TEXT,
	"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	-- admin plugin
	"role" TEXT NOT NULL DEFAULT 'user',
	"banned" BOOLEAN DEFAULT FALSE,
	"banReason" TEXT,
	"banExpires" TIMESTAMPTZ(3)
);

-- Active sessions. ipAddress and userAgent come from request headers.
CREATE TABLE IF NOT EXISTS "session" (
	id VARCHAR(36) NOT NULL PRIMARY KEY,
	"userId" VARCHAR(36) NOT NULL,
	"expiresAt" TIMESTAMPTZ(3) NOT NULL,
	"token" TEXT NOT NULL UNIQUE,
	"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMPTZ(3) NOT NULL,
	"ipAddress" TEXT,
	"userAgent" TEXT,
	-- admin plugin: id of the admin impersonating this session's user
	"impersonatedBy" VARCHAR(36),
	CONSTRAINT fk_session_user FOREIGN KEY ("userId") REFERENCES "user" (id) ON DELETE CASCADE
);

-- Password hashes (providerId 'credential') and linked OAuth accounts.
CREATE TABLE IF NOT EXISTS "account" (
	id VARCHAR(36) NOT NULL PRIMARY KEY,
	"accountId" TEXT NOT NULL,
	"userId" VARCHAR(36) NOT NULL,
	"providerId" TEXT NOT NULL,
	"accessToken" TEXT,
	"refreshToken" TEXT,
	"idToken" TEXT,
	"accessTokenExpiresAt" TIMESTAMPTZ(3),
	"refreshTokenExpiresAt" TIMESTAMPTZ(3),
	"scope" TEXT,
	"password" TEXT,
	"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMPTZ(3) NOT NULL,
	CONSTRAINT fk_account_user FOREIGN KEY ("userId") REFERENCES "user" (id) ON DELETE CASCADE
);

-- Short-lived values: password-reset tokens, and (with OAuth or other plugins)
-- sign-in state stored as JSON, which can be long.
CREATE TABLE IF NOT EXISTS "verification" (
	id VARCHAR(36) NOT NULL PRIMARY KEY,
	"identifier" TEXT NOT NULL,
	"value" TEXT NOT NULL,
	"expiresAt" TIMESTAMPTZ(3) NOT NULL,
	"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Rate-limit counters (rateLimit.storage = "database" in lib/auth.ts). One row
-- per client IP and endpoint; "lastRequest" is epoch milliseconds.
-- `npm run db:cleanup` deletes stale rows.
CREATE TABLE IF NOT EXISTS "rateLimit" (
	id VARCHAR(36) NOT NULL PRIMARY KEY,
	"key" TEXT NOT NULL UNIQUE,
	"count" INTEGER NOT NULL DEFAULT 0,
	"lastRequest" BIGINT NOT NULL
);

-- --------------------------------------------------------------------------------------
-- 2. INDEXES
-- --------------------------------------------------------------------------------------
-- Primary keys and UNIQUE columns (user.email, session.token, rateLimit.key)
-- are already indexed.

-- Admin user list, sorted by creation date
CREATE INDEX IF NOT EXISTS user_created_at_idx ON "user" ("createdAt");

-- A user's sessions; expired-session cleanup
CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session" ("userId");
CREATE INDEX IF NOT EXISTS session_expires_at_idx ON "session" ("expiresAt");

-- A user's accounts; each provider account linked only once
CREATE INDEX IF NOT EXISTS account_user_id_idx ON "account" ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_account_idx ON "account" ("providerId", "accountId");

-- Lookup by identifier only: "value" can be long JSON, too big for a btree entry.
DROP INDEX IF EXISTS verification_identifier_value_idx;
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification" ("identifier");
CREATE INDEX IF NOT EXISTS verification_expires_at_idx ON "verification" ("expiresAt");

-- Stale rate-limit cleanup. (No separate index on "key": UNIQUE covers it, and
-- every rate-limited request writes to this table.)
DROP INDEX IF EXISTS "rateLimit_key_idx";
CREATE INDEX IF NOT EXISTS "rateLimit_lastRequest_idx" ON "rateLimit" ("lastRequest");

-- --------------------------------------------------------------------------------------
-- 3. TRIGGERS
-- --------------------------------------------------------------------------------------

-- Keep "name" = "firstName lastName". Runs on INSERT and when either part
-- changes. CONCAT_WS skips NULLs, so there's never a stray leading/trailing
-- space; if both parts are blank, the existing name is kept.
CREATE OR REPLACE FUNCTION update_user_name()
RETURNS TRIGGER AS $$
BEGIN
	IF TG_OP = 'INSERT'
		OR NEW."firstName" IS DISTINCT FROM OLD."firstName"
		OR NEW."lastName" IS DISTINCT FROM OLD."lastName" THEN
		NEW."name" := COALESCE(
			NULLIF(CONCAT_WS(' ', NULLIF(TRIM(NEW."firstName"), ''), NULLIF(TRIM(NEW."lastName"), '')), ''),
			NEW."name"
		);
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS before_user_update_set_name ON "user";
DROP TRIGGER IF EXISTS set_user_name ON "user";
CREATE TRIGGER set_user_name
BEFORE INSERT OR UPDATE ON "user"
FOR EACH ROW
EXECUTE FUNCTION update_user_name();

-- Set "updatedAt" on every update. Better Auth also sets it; this covers
-- manual changes.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
	NEW."updatedAt" = CURRENT_TIMESTAMP;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_user_updated_at ON "user";
CREATE TRIGGER set_user_updated_at
BEFORE UPDATE ON "user"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_session_updated_at ON "session";
CREATE TRIGGER set_session_updated_at
BEFORE UPDATE ON "session"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_account_updated_at ON "account";
CREATE TRIGGER set_account_updated_at
BEFORE UPDATE ON "account"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_verification_updated_at ON "verification";
CREATE TRIGGER set_verification_updated_at
BEFORE UPDATE ON "verification"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
