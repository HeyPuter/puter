CREATE TABLE `old_app_names` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `app_uid` char(40) NOT NULL,
    `name` varchar(100) NOT NULL UNIQUE,
    `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (`app_uid`) REFERENCES `apps`(`uid`) ON DELETE CASCADE
);

CREATE INDEX `idx_old_app_names_name` ON `old_app_names` (`name`);
