CREATE TABLE `audit_user_to_user_permissions_new` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,

    "issuer_user_id" INTEGER DEFAULT NULL,
    "issuer_user_id_keep" INTEGER DEFAULT NULL,

    "holder_user_id" INTEGER DEFAULT NULL,
    "holder_user_id_keep" INTEGER DEFAULT NULL,

    "permission" TEXT NOT NULL,
    "extra" JSON DEFAULT NULL,

    "action" TEXT DEFAULT NULL,
    "reason" TEXT DEFAULT NULL,

    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY("issuer_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY("holder_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO `audit_user_to_user_permissions_new`
(
    `id`,
    `issuer_user_id`, `issuer_user_id_keep`,
    `holder_user_id`, `holder_user_id_keep`,
    `permission`, `extra`, `action`, `reason`,
    `created_at`
)
SELECT
    `id`,
    `issuer_user_id`, `issuer_user_id_keep`,
    `holder_user_id`, `holder_user_id_keep`,
    `permission`, `extra`, `action`, `reason`,
    `created_at`
FROM `audit_user_to_user_permissions`;
DROP TABLE `audit_user_to_user_permissions`;

ALTER TABLE `audit_user_to_user_permissions_new`
RENAME TO `audit_user_to_user_permissions`;
