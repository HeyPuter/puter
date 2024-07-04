CREATE TABLE `audit_user_to_group_permissions_new` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,

    "user_id" INTEGER DEFAULT NULL,
    "user_id_keep" INTEGER NOT NULL,

    "group_id" INTEGER DEFAULT NULL,
    "group_id_keep" INTEGER NOT NULL,

    "permission" TEXT NOT NULL,
    "extra" JSON DEFAULT NULL,

    "action" TEXT DEFAULT NULL,
    "reason" TEXT DEFAULT NULL,

    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY("group_id") REFERENCES "group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO `audit_user_to_group_permissions_new`
(
    `id`,
    `user_id`, `user_id_keep`,
    `group_id`, `group_id_keep`,
    `permission`, `extra`, `action`, `reason`,
    `created_at`
)
SELECT
    `id`,
    `user_id`, `user_id_keep`,
    `group_id`, `group_id_keep`,
    `permission`, `extra`, `action`, `reason`,
    `created_at`
FROM `audit_user_to_group_permissions`;
DROP TABLE `audit_user_to_group_permissions`;

ALTER TABLE `audit_user_to_group_permissions_new`
RENAME TO `audit_user_to_group_permissions`;

