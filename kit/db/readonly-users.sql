-- ======================================================================================
-- Read-only database users for AI agent MCP servers
-- ======================================================================================
-- Run the section for each database the agent should be able to inspect, as an
-- admin user, on DEV / STAGING databases only. Never give an agent production
-- credentials.
--
-- The read-only guarantee comes from these grants, NOT from the MCP server's own
-- "read-only mode": several SQL MCP servers have shipped bypasses (e.g. a
-- multi-statement "COMMIT; DROP ..."). With a SELECT-only user, a bypass can't
-- write anything.
--
-- Replace the placeholder passwords with strong, unique values and store them only
-- in .env.local / your MCP client's secret store.

-- --------------------------------------------------------------------------------------
-- MySQL (business database)
-- --------------------------------------------------------------------------------------
CREATE USER IF NOT EXISTS 'agent_ro'@'%' IDENTIFIED BY 'CHANGE_ME';
GRANT SELECT, SHOW VIEW ON `your_database`.* TO 'agent_ro'@'%';
-- Optional: cap how many connections the agent can hold open at once
-- ALTER USER 'agent_ro'@'%' WITH MAX_USER_CONNECTIONS 3;

-- --------------------------------------------------------------------------------------
-- SQL Server (business database)
-- --------------------------------------------------------------------------------------
-- USE [master];
-- CREATE LOGIN agent_ro WITH PASSWORD = 'CHANGE_ME', CHECK_POLICY = ON;
-- USE [YourDatabase];
-- CREATE USER agent_ro FOR LOGIN agent_ro;
-- ALTER ROLE db_datareader ADD MEMBER agent_ro;
-- GRANT VIEW DEFINITION TO agent_ro;   -- lets the agent read schema metadata

-- --------------------------------------------------------------------------------------
-- PostgreSQL (only if you use a generic Postgres MCP instead of Neon's MCP)
-- --------------------------------------------------------------------------------------
-- The auth database holds password hashes (account.password) and session tokens.
-- Grant schema visibility but NOT row access to the sensitive tables.
-- CREATE ROLE agent_ro LOGIN PASSWORD 'CHANGE_ME';
-- ALTER ROLE agent_ro SET default_transaction_read_only = on;
-- ALTER ROLE agent_ro SET statement_timeout = '15s';
-- GRANT CONNECT ON DATABASE your_database TO agent_ro;
-- GRANT USAGE ON SCHEMA public TO agent_ro;
-- GRANT SELECT ON "user", "rateLimit" TO agent_ro;   -- no session/account/verification
