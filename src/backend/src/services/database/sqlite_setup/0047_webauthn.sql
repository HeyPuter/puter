CREATE TABLE webauthn_credentials (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    credential_id TEXT    NOT NULL UNIQUE,
    public_key    TEXT    NOT NULL,
    counter       INTEGER NOT NULL DEFAULT 0,
    device_type   TEXT,
    backed_up     TINYINT(1) DEFAULT 0,
    transports    TEXT,
    name          TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at  TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE webauthn_challenges (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    challenge  TEXT    NOT NULL UNIQUE,
    type       TEXT    NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

ALTER TABLE user ADD COLUMN webauthn_enabled  TINYINT(1) DEFAULT 0;
ALTER TABLE user ADD COLUMN password_required TINYINT(1) DEFAULT 1;
