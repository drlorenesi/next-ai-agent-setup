-- 1. DATABASE CREATION
-- Note: It's generally best practice to manage the database creation outside the application
-- and only grant table-level privileges, but this script includes it for completeness.

-- CREATE DATABASE auth_db
--     WITH ENCODING 'UTF8'
--     LC_COLLATE = 'en_US.UTF-8'
--     LC_CTYPE = 'en_US.UTF-8';

-- \c auth_db;

-- --------------------------------------------------------------------------------------
-- 2. CLEAR EXISTING DATA
-- --------------------------------------------------------------------------------------

-- Truncate all tables to remove existing data
-- TRUNCATE is faster than DELETE and resets sequences
-- CASCADE ensures dependent tables are also truncated
-- TRUNCATE TABLE "user" CASCADE;
-- TRUNCATE TABLE "session" CASCADE;
-- TRUNCATE TABLE "account" CASCADE;
-- TRUNCATE TABLE "verification" CASCADE;

-- --------------------------------------------------------------------------------------
-- 3. TABLE DEFINITIONS
-- --------------------------------------------------------------------------------------

-- Table: user
-- Tracks core user data. Uses VARCHAR for names/image URLs and TIMESTAMP for logging.
CREATE TABLE IF NOT EXISTS "user" (
	id VARCHAR(36) NOT NULL PRIMARY KEY,
	"name" VARCHAR(255) NOT NULL,
	"firstName" VARCHAR(255), -- New Field, add NOT NULL constraint
	"lastName" VARCHAR(255), -- New Field, add NOT NULL constraint
	"email" VARCHAR(255) NOT NULL UNIQUE,
	"emailVerified" BOOLEAN NOT NULL,
	"image" VARCHAR(2048),
	"createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"role" VARCHAR(255) NOT NULL DEFAULT 'user',
	"banned" BOOLEAN,
	"banReason" TEXT,
	"banExpires" TIMESTAMP(3)
);

-- Table: session
-- Tracks active user sessions. Uses VARCHAR for IP/UserAgent and indexes on FK and expiry.
CREATE TABLE IF NOT EXISTS "session" (
	id VARCHAR(36) NOT NULL PRIMARY KEY,
	"userId" VARCHAR(36) NOT NULL,
	"expiresAt" TIMESTAMP(3) NOT NULL,
	"token" VARCHAR(255) NOT NULL UNIQUE,
	"createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" TIMESTAMP(3) NOT NULL,
	"ipAddress" VARCHAR(45),
	"userAgent" VARCHAR(1000),
	"impersonatedBy" VARCHAR(255),
	CONSTRAINT fk_session_user FOREIGN KEY ("userId") REFERENCES "user" (id) ON DELETE CASCADE
);

-- Table: account
-- Stores linked third-party accounts or local password hashes.
CREATE TABLE IF NOT EXISTS "account" (
	id VARCHAR(36) NOT NULL PRIMARY KEY,
	"accountId" VARCHAR(255) NOT NULL,
	"userId" VARCHAR(36) NOT NULL,
	"providerId" VARCHAR(50) NOT NULL,
	"accessToken" VARCHAR(2048),
	"refreshToken" VARCHAR(2048),
	"idToken" VARCHAR(2048),
	"accessTokenExpiresAt" TIMESTAMP(3),
	"refreshTokenExpiresAt" TIMESTAMP(3),
	"scope" VARCHAR(512),
	"password" VARCHAR(255), -- Stores a fixed-length hash (e.g., bcrypt/Argon2)
	"createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" TIMESTAMP(3) NOT NULL,
	CONSTRAINT fk_account_user FOREIGN KEY ("userId") REFERENCES "user" (id) ON DELETE CASCADE
);

-- Table: verification
-- Stores temporary codes for email verification or password reset (must be fast and indexable).
CREATE TABLE IF NOT EXISTS "verification" (
	id VARCHAR(36) NOT NULL PRIMARY KEY,
	"identifier" VARCHAR(255) NOT NULL,
	"value" VARCHAR(255) NOT NULL,
	"expiresAt" TIMESTAMP(3) NOT NULL,
	"createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Table: rateLimit
-- Tracks rate limiting data for various actions (e.g., login attempts, verification requests).
CREATE TABLE IF NOT EXISTS "rateLimit" (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  "key" VARCHAR(255) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "lastRequest" BIGINT NOT NULL,
  UNIQUE("key")
);

-- --------------------------------------------------------------------------------------
-- 4. INDEX DEFINITIONS (NON-PRIMARY/NON-UNIQUE)
-- --------------------------------------------------------------------------------------

-- Indexes for 'user' table
-- Index to allow fast sorting/filtering of the user list by creation date
CREATE INDEX IF NOT EXISTS user_created_at_idx ON "user" ("createdAt");

-- Indexes for 'session' table
-- Index on the Foreign Key for fast lookup of a user's sessions
CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session" ("userId");
-- Index for fast cleanup of expired sessions
CREATE INDEX IF NOT EXISTS session_expires_at_idx ON "session" ("expiresAt");

-- Indexes for 'account' table
-- Index on the Foreign Key for fast lookup of a user's linked accounts
CREATE INDEX IF NOT EXISTS account_user_id_idx ON "account" ("userId");
-- Compound UNIQUE index to ensure a provider's account ID is only linked once
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_account_idx ON "account" ("providerId", "accountId");

-- Indexes for 'verification' table
-- Compound index for fast lookup of a verification record by its target and value
CREATE INDEX IF NOT EXISTS verification_identifier_value_idx ON "verification" (identifier, value);
-- Index for fast cleanup of expired codes
CREATE INDEX IF NOT EXISTS verification_expires_at_idx ON "verification" ("expiresAt");

-- Indexes for 'rateLimit' table
-- Index on the key for fast lookup of rate limit records
CREATE INDEX IF NOT EXISTS "rateLimit_key_idx" ON "rateLimit" ("key");
-- Index for cleanup of old entries
CREATE INDEX IF NOT EXISTS "rateLimit_lastRequest_idx" ON "rateLimit" ("lastRequest");

-- --------------------------------------------------------------------------------------
-- 5. TRIGGERS (update 'name' if either 'firstName' or 'lastName' change)
-- --------------------------------------------------------------------------------------

-- Function to update name based on firstName and lastName
CREATE OR REPLACE FUNCTION update_user_name()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if either firstName or lastName has changed
    IF NEW."firstName" IS DISTINCT FROM OLD."firstName" OR NEW."lastName" IS DISTINCT FROM OLD."lastName" THEN
        -- Concatenate and set the new value for the 'name' column
        NEW.name := CONCAT(NEW."firstName", ' ', NEW."lastName");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (using CREATE OR REPLACE to avoid "already exists" errors)
CREATE OR REPLACE TRIGGER before_user_update_set_name
BEFORE UPDATE ON "user"
FOR EACH ROW
EXECUTE FUNCTION update_user_name();

-- --------------------------------------------------------------------------------------
-- 6. ADDITIONAL UTILITIES
-- --------------------------------------------------------------------------------------

-- Function to automatically update 'updatedAt' timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updatedAt trigger to user table
DROP TRIGGER IF EXISTS set_user_updated_at ON "user";
CREATE TRIGGER set_user_updated_at
BEFORE UPDATE ON "user"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Apply updatedAt trigger to account table
DROP TRIGGER IF EXISTS set_account_updated_at ON "account";
CREATE TRIGGER set_account_updated_at
BEFORE UPDATE ON "account"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Apply updatedAt trigger to verification table
DROP TRIGGER IF EXISTS set_verification_updated_at ON "verification";
CREATE TRIGGER set_verification_updated_at
BEFORE UPDATE ON "verification"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------------------------
-- 7. OTHER QUERIES
-- --------------------------------------------------------------------------------------

-- Example: Alter table to add a column (if not already present)
-- ALTER TABLE "user"
-- ADD COLUMN name VARCHAR(255) NOT NULL;