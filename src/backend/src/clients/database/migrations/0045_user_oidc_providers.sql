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
