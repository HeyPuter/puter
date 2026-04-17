-- drop all tables

DROP TABLE IF EXISTS `monthly_usage_counts`;
DROP TABLE IF EXISTS `access_token_permissions`;
DROP TABLE IF EXISTS `auth_audit`;
DROP TABLE IF EXISTS `general_analytics`;
DROP TABLE IF EXISTS `audit_user_to_app_permissions`;
DROP TABLE IF EXISTS `user_to_app_permissions`;
DROP TABLE IF EXISTS `service_usage_monthly`;
DROP TABLE IF EXISTS `rl_usage_fixed_window`;
DROP TABLE IF EXISTS `app_update_audit`;
DROP TABLE IF EXISTS `user_update_audit`;
DROP TABLE IF EXISTS `storage_audit`;
DROP TABLE IF EXISTS `user`;
DROP TABLE IF EXISTS `subdomains`;
DROP TABLE IF EXISTS `kv`;
DROP TABLE IF EXISTS `fsentry_versions`;
DROP TABLE IF EXISTS `fsentries`;
DROP TABLE IF EXISTS `feedback`;
DROP TABLE IF EXISTS `app_opens`;
DROP TABLE IF EXISTS `app_filetype_association`;
DROP TABLE IF EXISTS `apps`;

CREATE TABLE `apps` (
  `id` INTEGER PRIMARY KEY,
  `uid` char(40) NOT NULL UNIQUE,
  `owner_user_id` int(10) DEFAULT NULL, -- changed by: 0011
  `icon` longtext,
  `name` varchar(100) NOT NULL UNIQUE,
  `title` varchar(100) NOT NULL,
  `description` text,
  `godmode` tinyint(1) DEFAULT '0',
  `maximize_on_start` tinyint(1) DEFAULT '0',
  `index_url` text NOT NULL,
  `approved_for_listing` tinyint(1) DEFAULT '0',
  `approved_for_opening_items` tinyint(1) DEFAULT '0',
  `approved_for_incentive_program` tinyint(1) DEFAULT '0',
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_review` timestamp NULL DEFAULT NULL,

  -- 0006
    `tags` VARCHAR(255),
  -- 0015
    `app_owner` int(10) DEFAULT NULL,
    FOREIGN KEY (`app_owner`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE `app_filetype_association` (
  `id` INTEGER PRIMARY KEY,
  `app_id` int(10) NOT NULL,
  `type` varchar(60) NOT NULL
);

CREATE TABLE `app_opens` (
  `_id` INTEGER PRIMARY KEY,
  `app_uid` char(40) NOT NULL,
  `user_id` int(10) NOT NULL,
  `ts` int(10) NOT NULL,
  `human_ts` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE `feedback` (
  `id` INTEGER PRIMARY KEY,
  `user_id` int(10) NOT NULL,
  `message` text,
  `ts` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `fsentries` (
  `id` INTEGER PRIMARY KEY,
  `uuid` char(36) NOT NULL UNIQUE,
  `name` varchar(767) NOT NULL,
  `path` varchar(4096) DEFAULT NULL,
  `bucket` varchar(50) DEFAULT NULL,
  `bucket_region` varchar(30) DEFAULT NULL,
  `public_token` char(36) DEFAULT NULL,
  `file_request_token` char(36) DEFAULT NULL,
  `is_shortcut` tinyint(1) DEFAULT '0',
  `shortcut_to` int(10) DEFAULT NULL,
  `user_id` int(10) NOT NULL,
  `parent_id` int(10) DEFAULT NULL,
  `parent_uid` CHAR(36) NULL DEFAULT NULL,
  `associated_app_id` int(10) DEFAULT NULL,
  `is_dir` tinyint(1) DEFAULT '0',
  `layout` varchar(30) DEFAULT NULL,
  `sort_by` TEXT DEFAULT NULL,
  `sort_order` TEXT DEFAULT NULL,
  `is_public` tinyint(1) DEFAULT NULL,
  `thumbnail` longtext,
  `immutable` tinyint(1) NOT NULL DEFAULT '0',
  `metadata` text,
  `modified` int(10) NOT NULL,
  `created` int(10) DEFAULT NULL,
  `accessed` int(10) DEFAULT NULL,
  `size` bigint(20) DEFAULT NULL,
  `symlink_path` varchar(260) DEFAULT NULL,
  `is_symlink` tinyint(1) DEFAULT '0'
);

CREATE INDEX idx_parentId_name ON fsentries (`parent_id`, `name`);
CREATE INDEX idx_path ON fsentries (`path`);

CREATE TABLE `fsentry_versions` (
  `id` INTEGER PRIMARY KEY,
  `fsentry_id` int(10) NOT NULL,
  `fsentry_uuid` char(36) NOT NULL,
  `version_id` varchar(60) NOT NULL,
  `user_id` int(10) DEFAULT NULL,
  `message` mediumtext,
  `ts_epoch` int(10) DEFAULT NULL
);

CREATE TABLE `kv` (
  `id` INTEGER PRIMARY KEY,
  `app` char(40) DEFAULT NULL,
  `user_id` int(10) NOT NULL,
  `kkey_hash` bigint(20) NOT NULL,
  `kkey` text NOT NULL,
  `value` text,

  -- 0016
    `migrated` tinyint(1) DEFAULT '0',
  
  -- 0019
    UNIQUE (user_id, app, kkey_hash)
);

CREATE TABLE `subdomains` (
  `id` INTEGER PRIMARY KEY,
  `uuid` varchar(40) DEFAULT NULL,
  `subdomain` varchar(64) NOT NULL,
  `user_id` int(10) NOT NULL,
  `root_dir_id` int(10) DEFAULT NULL,
  `associated_app_id` int(10) DEFAULT NULL,
  `ts` timestamp NULL DEFAULT CURRENT_TIMESTAMP,

  -- 0015
    `app_owner` int(10) DEFAULT NULL,
    FOREIGN KEY (`app_owner`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE `user` (
  `id` INTEGER PRIMARY KEY,
  `uuid` char(36) NOT NULL,
  `username` varchar(50) DEFAULT NULL,
  `email` varchar(256) DEFAULT NULL,
  `password` varchar(225) DEFAULT NULL,
  `free_storage` bigint(20) DEFAULT NULL,
  `max_subdomains` int(10) DEFAULT NULL,
  `taskbar_items` text,
  `desktop_uuid`   CHAR(36) NULL DEFAULT NULL,
  `appdata_uuid`   CHAR(36) NULL DEFAULT NULL,
  `documents_uuid` CHAR(36) NULL DEFAULT NULL,
  `pictures_uuid`  CHAR(36) NULL DEFAULT NULL,
  `videos_uuid`    CHAR(36) NULL DEFAULT NULL,
  `trash_uuid`     CHAR(36) NULL DEFAULT NULL,
  `trash_id` INT NULL DEFAULT NULL,
  `appdata_id` INT NULL DEFAULT NULL,
  `desktop_id` INT NULL DEFAULT NULL,
  `documents_id` INT NULL DEFAULT NULL,
  `pictures_id` INT NULL DEFAULT NULL,
  `videos_id` INT NULL DEFAULT NULL,
  `referrer` varchar(64) DEFAULT NULL,
  `desktop_bg_url` text,
  `desktop_bg_color` varchar(20) DEFAULT NULL,
  `desktop_bg_fit` varchar(16) DEFAULT NULL,
  `pass_recovery_token` char(36) DEFAULT NULL,
  `requires_email_confirmation` tinyint(1) NOT NULL DEFAULT '0',
  `email_confirm_code` varchar(8) DEFAULT NULL,
  `email_confirm_token` char(36) DEFAULT NULL,
  `email_confirmed` tinyint(1) NOT NULL DEFAULT '0',
  `dev_first_name` varchar(100) DEFAULT NULL,
  `dev_last_name` varchar(100) DEFAULT NULL,
  `dev_paypal` varchar(100) DEFAULT NULL,
  `dev_approved_for_incentive_program` tinyint(1) DEFAULT '0',
  `dev_joined_incentive_program` tinyint(1) DEFAULT '0',
  `suspended` tinyint(1) DEFAULT NULL,
  `unsubscribed` tinyint(4) NOT NULL DEFAULT '0',
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_activity_ts` timestamp NULL DEFAULT NULL,

  -- 0005
    `referral_code` VARCHAR(16) DEFAULT NULL,
    `referred_by` int(10) DEFAULT NULL,

  -- 0007
    `unconfirmed_change_email` varchar(256) DEFAULT NULL,
    `change_email_confirm_token` varchar(256) DEFAULT NULL,

  FOREIGN KEY (`referred_by`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE

);

-- 0005

CREATE TABLE `storage_audit` (
    `id` INTEGER PRIMARY KEY,
    `user_id` int(10) DEFAULT NULL,
    `user_id_keep` int(10) NOT NULL,
    `is_subtract` tinyint(1) NOT NULL DEFAULT '0',
    `amount` bigint(20) NOT NULL,
    `field_a` VARCHAR(16) DEFAULT NULL,
    `field_b` VARCHAR(16) DEFAULT NULL,
    `reason` VARCHAR(255) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 0008

CREATE TABLE `user_update_audit` (
    `id` INTEGER PRIMARY KEY,
    `user_id` int(10) DEFAULT NULL,
    `user_id_keep` int(10) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

    `old_email` varchar(256) DEFAULT NULL,
    `new_email` varchar(256) DEFAULT NULL,
    `old_username` varchar(50) DEFAULT NULL,
    `new_username` varchar(50) DEFAULT NULL,

    -- a message from the service that updated the user's information
    `reason` VARCHAR(255) DEFAULT NULL,

    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE `app_update_audit` (
    `id` INTEGER PRIMARY KEY,
    `app_id` int(10) DEFAULT NULL,
    `app_id_keep` int(10) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

    `old_name` varchar(50) DEFAULT NULL,
    `new_name` varchar(50) DEFAULT NULL,

    -- a message from the service that updated the app's information
    `reason` VARCHAR(255) DEFAULT NULL,

    FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
);

-- 0009

CREATE TABLE `rl_usage_fixed_window` (
    `key` varchar(255) NOT NULL,
    `window_start` bigint NOT NULL,
    `count` int NOT NULL,

    PRIMARY KEY (`key`)
);

CREATE TABLE `service_usage_monthly` (
    `key` varchar(255) NOT NULL,
    `year` int NOT NULL,
    `month` int NOT NULL,

    -- these columns are used for querying, so they should also
    -- be included in the key
    `user_id` int(10) DEFAULT NULL,
    `app_id` int(10) DEFAULT NULL,

    `count` int NOT NULL,

    -- 0012
    `extra` JSON DEFAULT NULL,

    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    PRIMARY KEY (`key`, `year`, `month`)
);

-- 0010

CREATE TABLE `user_to_app_permissions` (
    `user_id` int(10) NOT NULL,
    `app_id` int(10) NOT NULL,
    `permission` varchar(255) NOT NULL,
    `extra` JSON DEFAULT NULL,

    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (`user_id`, `app_id`, `permission`)
);

CREATE TABLE `audit_user_to_app_permissions` (
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

-- 0013

CREATE TABLE `general_analytics` (
    `id` INTEGER PRIMARY KEY,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

    `uid` CHAR(40) NOT NULL,
    `trace_id` VARCHAR(40) DEFAULT NULL,
    `user_id` int(10) DEFAULT NULL,
    `user_id_keep` int(10) DEFAULT NULL,
    `app_id` int(10) DEFAULT NULL,
    `app_id_keep` int(10) DEFAULT NULL,
    `server_id` VARCHAR(40) DEFAULT NULL,
    `actor_type` VARCHAR(40) DEFAULT NULL,

    `tags` JSON,
    `fields` JSON,

    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
);

-- 0014

CREATE TABLE `auth_audit` (
    `id` INTEGER PRIMARY KEY,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

    `uid` CHAR(40) NOT NULL,
    `ip_address` VARCHAR(45) DEFAULT NULL,
    `ua_string` VARCHAR(255) DEFAULT NULL,

    `action` VARCHAR(40) DEFAULT NULL,

    `requester` JSON,
    `body` JSON,
    `extra` JSON,

    `has_parse_error` TINYINT(1) DEFAULT 0

);

-- 0017

CREATE TABLE `access_token_permissions` (
    `id` INTEGER PRIMARY KEY,
    `token_uid` CHAR(40) NOT NULL,
    `authorizer_user_id` int(10) DEFAULT NULL,
    `authorizer_app_id` int(10) DEFAULT NULL,
    `permission` varchar(255) NOT NULL,
    `extra` JSON DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP

);

-- 0018

CREATE TABLE `monthly_usage_counts` (
    `year` int NOT NULL,
    `month` int NOT NULL,
    -- what kind of service we're counting
    `service_type` varchar(40) NOT NULL,
    -- an identifier in case we offer multiple services of the same type
    `service_name` varchar(40) NOT NULL,
    -- an identifier for the actor who is using the service
    `actor_key` varchar(255) NOT NULL,

    -- the pricing category is a set of values which can be combined
    -- with locally-fungible values to determine the price of a service
    `pricing_category` JSON NOT NULL,
    `pricing_category_hash` binary(20) NOT NULL,

    -- now many times this row has been updated
    `count` int DEFAULT 0,

    -- values which are locally-fungible within the pricing category
    `value_uint_1` int DEFAULT NULL,
    `value_uint_2` int DEFAULT NULL,
    `value_uint_3` int DEFAULT NULL,

    PRIMARY KEY (
        `year`, `month`,
        `service_type`, `service_name`,
        `actor_key`,
        `pricing_category_hash`
    )
);
