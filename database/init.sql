-- CloudFlare ImgBed D1 Database Initialization Script
-- 这个脚本用于初始化D1数据库

-- 删除已存在的表（如果需要重新初始化）
-- 注意：在生产环境中使用时请谨慎
-- DROP TABLE IF EXISTS files;
-- DROP TABLE IF EXISTS settings;
-- DROP TABLE IF EXISTS index_operations;
-- DROP TABLE IF EXISTS index_metadata;
-- DROP TABLE IF EXISTS other_data;

-- 执行主要的数据库架构创建

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    value TEXT,
    metadata TEXT NOT NULL,
    file_name TEXT,
    file_type TEXT,
    file_size TEXT,
    upload_ip TEXT,
    upload_address TEXT,
    list_type TEXT,
    timestamp INTEGER,
    label TEXT,
    directory TEXT,
    channel TEXT,
    channel_name TEXT,
    tg_file_id TEXT,
    tg_chat_id TEXT,
    tg_bot_token TEXT,
    is_chunked BOOLEAN DEFAULT FALSE,
    tags TEXT, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    category TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS index_operations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    data TEXT NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS index_metadata (
    key TEXT PRIMARY KEY,
    last_updated INTEGER,
    total_count INTEGER DEFAULT 0,
    last_operation_id TEXT,
    chunk_count INTEGER DEFAULT 0,
    chunk_size INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS other_data (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_files_timestamp ON files(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_files_directory ON files(directory);
CREATE INDEX IF NOT EXISTS idx_files_channel ON files(channel);
CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type);
CREATE INDEX IF NOT EXISTS idx_files_upload_ip ON files(upload_ip);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_tags ON files(tags);
-- 文件有效期：只索引设置了 ExpiresAt 的文件
CREATE INDEX IF NOT EXISTS idx_files_expires ON files(json_extract(metadata, '$.ExpiresAt'))
    WHERE json_extract(metadata, '$.ExpiresAt') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);

CREATE INDEX IF NOT EXISTS idx_index_operations_timestamp ON index_operations(timestamp);
CREATE INDEX IF NOT EXISTS idx_index_operations_processed ON index_operations(processed);
CREATE INDEX IF NOT EXISTS idx_index_operations_type ON index_operations(type);

CREATE INDEX IF NOT EXISTS idx_other_data_type ON other_data(type);

CREATE TRIGGER IF NOT EXISTS update_files_updated_at 
    AFTER UPDATE ON files
    BEGIN
        UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_settings_updated_at 
    AFTER UPDATE ON settings
    BEGIN
        UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
    END;

CREATE TRIGGER IF NOT EXISTS update_index_metadata_updated_at 
    AFTER UPDATE ON index_metadata
    BEGIN
        UPDATE index_metadata SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
    END;

CREATE TRIGGER IF NOT EXISTS update_other_data_updated_at 
    AFTER UPDATE ON other_data
    BEGIN
        UPDATE other_data SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
    END;

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
CREATE TABLE IF NOT EXISTS file_claims (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_timestamp INTEGER,
  account_id TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_pending ON file_claims(account_id,file_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(json_extract(metadata,'$.OwnerAccountId'));
CREATE TABLE IF NOT EXISTS hf_upload_intents (
  file_path TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  channel_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS claim_assign_file AFTER UPDATE OF status ON file_claims
WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
  UPDATE files SET metadata=json_set(metadata,'$.OwnerAccountId',NEW.account_id)
    WHERE id=NEW.file_id AND timestamp IS NEW.file_timestamp AND json_extract(metadata,'$.OwnerAccountId') IS NULL;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT,'File ownership changed') END;
  UPDATE file_claims SET status='rejected' WHERE status='pending' AND file_id=NEW.file_id;
END;

CREATE TRIGGER IF NOT EXISTS preserve_file_owner BEFORE INSERT ON files
WHEN EXISTS(SELECT 1 FROM files WHERE id=NEW.id
  AND json_extract(metadata,'$.OwnerAccountId') IS NOT json_extract(NEW.metadata,'$.OwnerAccountId'))
BEGIN
  SELECT RAISE(ABORT,'File ID already belongs to another uploader');
END;
-- Track each indexed object's last contribution, including INSERT OR REPLACE writes.
CREATE TABLE IF NOT EXISTS route_members (
    id TEXT PRIMARY KEY, channel TEXT NOT NULL, name TEXT NOT NULL, bytes INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS route_usage (
    channel TEXT NOT NULL, name TEXT NOT NULL, files INTEGER NOT NULL, bytes INTEGER NOT NULL,
    PRIMARY KEY(channel,name)
);
CREATE TABLE IF NOT EXISTS route_reservations (
    id TEXT PRIMARY KEY, channel TEXT NOT NULL, name TEXT NOT NULL, bytes INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS route_expiry ON route_reservations(expires);
CREATE TRIGGER IF NOT EXISTS route_member_added AFTER INSERT ON route_members BEGIN
    INSERT INTO route_usage VALUES(NEW.channel, NEW.name, 1, NEW.bytes)
    ON CONFLICT(channel,name) DO UPDATE SET files=files+1, bytes=bytes+excluded.bytes;
END;
CREATE TRIGGER IF NOT EXISTS route_member_removed AFTER DELETE ON route_members BEGIN
    UPDATE route_usage SET files=files-1, bytes=bytes-OLD.bytes WHERE channel=OLD.channel AND name=OLD.name;
END;
CREATE TRIGGER IF NOT EXISTS route_file_added AFTER INSERT ON files BEGIN
    DELETE FROM route_members WHERE id=NEW.id;
    INSERT INTO route_members VALUES(NEW.id, coalesce(NEW.channel,''),coalesce(NEW.channel_name,''),
        max(0,cast(coalesce(json_extract(NEW.metadata,'$.FileSizeBytes'),NEW.file_size*1048576,0) AS INTEGER)));
END;
CREATE TRIGGER IF NOT EXISTS route_file_changed AFTER UPDATE OF id,channel,channel_name,file_size,metadata ON files BEGIN
    DELETE FROM route_members WHERE id=OLD.id OR id=NEW.id;
    INSERT INTO route_members VALUES(NEW.id, coalesce(NEW.channel,''),coalesce(NEW.channel_name,''),
        max(0,cast(coalesce(json_extract(NEW.metadata,'$.FileSizeBytes'),NEW.file_size*1048576,0) AS INTEGER)));
END;
CREATE TRIGGER IF NOT EXISTS route_file_removed AFTER DELETE ON files BEGIN
    DELETE FROM route_members WHERE id=OLD.id;
END;
INSERT OR IGNORE INTO route_members SELECT id, coalesce(channel,''),coalesce(channel_name,''),
    max(0,cast(coalesce(json_extract(metadata,'$.FileSizeBytes'),file_size*1048576,0) AS INTEGER)) FROM files;
