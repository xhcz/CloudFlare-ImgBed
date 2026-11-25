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
