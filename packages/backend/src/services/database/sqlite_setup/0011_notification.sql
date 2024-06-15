CREATE TABLE `notification` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `user_id` INTEGER NOT NULL,
    `uid` TEXT NOT NULL UNIQUE,
    `value` JSON NOT NULL,
    `read` tinyint(1) DEFAULT '0',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
