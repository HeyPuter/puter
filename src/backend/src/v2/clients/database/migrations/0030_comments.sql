CREATE TABLE `user_comments` (
    `id` INTEGER PRIMARY KEY,
    `uid` TEXT NOT NULL UNIQUE,
    `user_id` INTEGER NOT NULL,
    `metadata` JSON DEFAULT NULL,
    `text` TEXT NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX `idx_user_comments_uid` ON `user_comments` (`uid`);

CREATE TABLE `user_fsentry_comments` (
    `id` INTEGER PRIMARY KEY,
    `user_comment_id` INTEGER NOT NULL,
    `fsentry_id` INTEGER NOT NULL,
    FOREIGN KEY("user_comment_id") REFERENCES "user_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("fsentry_id") REFERENCES "fsentries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `user_fsentry_version_comments` (
    `id` INTEGER PRIMARY KEY,
    `user_comment_id` INTEGER NOT NULL,
    `fsentry_version_id` INTEGER NOT NULL,
    FOREIGN KEY("user_comment_id") REFERENCES "user_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("fsentry_version_id") REFERENCES "fsentry_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `user_group_comments` (
    `id` INTEGER PRIMARY KEY,
    `user_comment_id` INTEGER NOT NULL,
    `group_id` INTEGER NOT NULL,
    FOREIGN KEY("user_comment_id") REFERENCES "user_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("group_id") REFERENCES "group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `user_user_comments` (
    `id` INTEGER PRIMARY KEY,
    `user_comment_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    FOREIGN KEY("user_comment_id") REFERENCES "user_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
