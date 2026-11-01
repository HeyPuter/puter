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

-- Schedule definitions. See sqlite/0100_event-schedules.sql for the columns.
-- Idempotent: `CREATE TABLE IF NOT EXISTS` with the indexes inline, so a
-- replay is a no-op.

CREATE TABLE IF NOT EXISTS `event_schedules` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `uid` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `namespace` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `kind` varchar(16) NOT NULL,
    `sub_id` varchar(80) DEFAULT NULL,
    `holder_user_id` int unsigned NOT NULL,
    `app_uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
    `region` varchar(64) NOT NULL,
    `start_at` bigint NOT NULL,
    `every_ms` bigint DEFAULT NULL,
    `cron` varchar(128) DEFAULT NULL,
    `tz` varchar(64) NOT NULL DEFAULT 'UTC',
    `ends_at` bigint DEFAULT NULL,
    `rate_per_hour` int unsigned NOT NULL,
    `min_gap_ms` bigint DEFAULT NULL,
    `handler_depth` tinyint unsigned NOT NULL DEFAULT 0,
    `action` varchar(64) DEFAULT NULL,
    `payload` json DEFAULT NULL,
    `state` varchar(16) NOT NULL DEFAULT 'active',
    `send_token` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    `send_until` bigint DEFAULT NULL,
    `end_reason` varchar(32) DEFAULT NULL,
    `version` bigint NOT NULL DEFAULT 1,
    `deleted_at` bigint DEFAULT NULL,
    `created_at` bigint NOT NULL,
    `updated_at` bigint NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_event_schedules_uid` (`uid`),
    KEY `idx_event_schedules_ns_region_updated` (`namespace`, `region`, `updated_at`, `id`),
    KEY `idx_event_schedules_ns_region_id` (`namespace`, `region`, `id`),
    KEY `idx_event_schedules_holder` (`holder_user_id`, `app_uid`, `deleted_at`),
    KEY `idx_event_schedules_holder_ns_id` (`holder_user_id`, `namespace`, `id`),
    KEY `idx_event_schedules_holder_ns_app_id` (`holder_user_id`, `namespace`, `app_uid`, `id`),
    KEY `idx_event_schedules_sub` (`sub_id`),
    KEY `idx_event_schedules_app_kind` (`app_uid`, `kind`),
    KEY `idx_event_schedules_deleted` (`deleted_at`),
    CONSTRAINT `fk_event_schedules_holder` FOREIGN KEY (`holder_user_id`)
        REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
