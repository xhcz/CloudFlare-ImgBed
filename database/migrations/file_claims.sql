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
