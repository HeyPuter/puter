CREATE TABLE `thread` (
    `id` INTEGER PRIMARY KEY,
    `uid` TEXT NOT NULL UNIQUE,
    `parent_uid` TEXT NULL DEFAULT NULL,
    `owner_user_id` INTEGER NOT NULL,
    `schema` TEXT NULL DEFAULT NULL,
    `text` TEXT NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("parent_uid") REFERENCES "thread" ("uid") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("owner_user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX `idx_thread_uid` ON `thread` (`uid`);
