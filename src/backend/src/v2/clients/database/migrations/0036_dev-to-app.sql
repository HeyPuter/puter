CREATE TABLE `dev_to_app_permissions` (
    `user_id` int(10) NOT NULL,
    `app_id` int(10) NOT NULL,
    `permission` varchar(255) NOT NULL,
    `extra` JSON DEFAULT NULL,

    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (`user_id`, `app_id`, `permission`)
);

CREATE TABLE `audit_dev_to_app_permissions` (
    `id` INTEGER PRIMARY KEY,

    `user_id` int(10) DEFAULT NULL,
    `user_id_keep` int(10) NOT NULL,

    `app_id` int(10) DEFAULT NULL,
    `app_id_keep` int(10) NOT NULL,

    `permission` varchar(255) NOT NULL,
    `extra` JSON DEFAULT NULL,

    `action` VARCHAR(16) DEFAULT NULL, -- "granted" or "revoked"
    `reason` VARCHAR(255) DEFAULT NULL,

    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
);