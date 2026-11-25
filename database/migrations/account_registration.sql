CREATE TABLE IF NOT EXISTS imgbed_accounts (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('unverified','pending','approved','rejected')),
    platform TEXT,
    platform_user_id TEXT,
    created_at INTEGER NOT NULL,
    verification_hash TEXT UNIQUE,
    verification_expires INTEGER,
    application_hash TEXT NOT NULL UNIQUE,
    UNIQUE(platform,platform_user_id)
);
CREATE TABLE IF NOT EXISTS imgbed_account_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES imgbed_accounts(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS imgbed_account_session_expiry ON imgbed_account_sessions(expires);
CREATE TABLE IF NOT EXISTS imgbed_account_limits (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS imgbed_account_limit_expiry ON imgbed_account_limits(expires);
