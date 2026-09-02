-- Copyright (C) 2024-present Puter Technologies Inc.
--
-- This file is part of Puter.
--
-- Puter is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as published
-- by the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU Affero General Public License for more details.
--
-- You should have received a copy of the GNU Affero General Public License
-- along with this program.  If not, see <https://www.gnu.org/licenses/>.

-- Subscriptions that outlive the connection that made them. See
-- sqlite/0075_event-subscriptions.sql for the column rationale.
--
-- Idempotent: `CREATE TABLE IF NOT EXISTS` with the indexes declared inline,
-- as mig_23. There is no per-file applied-state tracking, so a replay has to
-- be a no-op.

CREATE TABLE IF NOT EXISTS `event_subscriptions` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `sub_id` varchar(80) NOT NULL,
    `token` varchar(255) NOT NULL,
    `owner_user_id` int unsigned NOT NULL,
    `holder_user_id` int unsigned NOT NULL,
    -- Matches `apps`.`uid` exactly, charset included, so an equality against
    -- one never falls back to a conversion. No foreign key: a row outlives the
    -- app that made it, which is what keeps it revocable afterwards.
    `app_uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci
        DEFAULT NULL,
    `subject` varchar(4096) NOT NULL,
    `anchor_uid` char(36) NOT NULL,
    `anchor_path` varchar(4096) NOT NULL,
    `match` varchar(1024) DEFAULT NULL,
    `delivery` varchar(16) NOT NULL,
    `ops` varchar(64) DEFAULT NULL,
    `handler_name` varchar(128) DEFAULT NULL,
    `targets` json NOT NULL,
    `context` text,
    `permission` varchar(32) NOT NULL,
    `suspended_at` bigint DEFAULT NULL,
    `suspended_reason` varchar(64) DEFAULT NULL,
    `expires_at` bigint DEFAULT NULL,
    `created_at` bigint NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_event_subscriptions_sub_id` (`sub_id`),
    KEY `idx_event_subscriptions_token` (`token`),
    KEY `idx_event_subscriptions_holder` (`holder_user_id`, `app_uid`),
    KEY `idx_event_subscriptions_owner` (`owner_user_id`),
    CONSTRAINT `fk_event_subscriptions_owner` FOREIGN KEY (`owner_user_id`)
        REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_event_subscriptions_holder` FOREIGN KEY (`holder_user_id`)
        REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
