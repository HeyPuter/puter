CREATE TABLE `new_kv` (
    `id` INTEGER PRIMARY KEY,
    `app` char(40) DEFAULT NULL,
    `user_id` int(10) NOT NULL,
    `kkey_hash` bigint(20) NOT NULL,
    `kkey` text NOT NULL,
    `value` JSON,
    `migrated` tinyint(1) DEFAULT '0',
    UNIQUE (user_id, app, kkey_hash)
);

INSERT INTO `new_kv`
(
    `app`,
    `user_id`,
    `kkey_hash`,
    `kkey`,
    `value`
)
SELECT
    `app`,
    `user_id`,
    `kkey_hash`,
    `kkey`,
    json_quote(value)
FROM `kv`;

DROP TABLE `kv`;

ALTER TABLE `new_kv`
RENAME TO `kv`;
