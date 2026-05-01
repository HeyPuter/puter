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

-- OIDC/OAuth2: link user accounts to identity providers (e.g. Google)
-- Used for "Sign in with Google" login and signup

CREATE TABLE `user_oidc_providers` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `user_id` INTEGER NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `provider_sub` VARCHAR(255) NOT NULL,
    `refresh_token` TEXT DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(`provider`, `provider_sub`),
    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_user_oidc_providers_provider_sub` ON `user_oidc_providers` (`provider`, `provider_sub`);
CREATE INDEX `idx_user_oidc_providers_user_id` ON `user_oidc_providers` (`user_id`);
