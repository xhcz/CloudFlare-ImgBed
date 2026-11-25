CREATE TABLE IF NOT EXISTS registration_bots (
  id TEXT PRIMARY KEY, platform TEXT NOT NULL, account_id TEXT NOT NULL,
  url TEXT NOT NULL, callback_url TEXT NOT NULL, secret TEXT NOT NULL,
  command_id TEXT, enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS registration_challenges (
  code_hash TEXT PRIMARY KEY, nonce TEXT UNIQUE NOT NULL, bot_id TEXT NOT NULL,
  platform_user TEXT NOT NULL, answer INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS registration_challenges_expiry ON registration_challenges(expires);
