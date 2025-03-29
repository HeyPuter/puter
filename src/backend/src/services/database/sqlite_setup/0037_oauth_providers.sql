-- Create oauth_providers table
CREATE TABLE `oauth_providers` (
  `id` INTEGER PRIMARY KEY,
  `user_id` int(10) NOT NULL,
  `provider` varchar(50) NOT NULL,
  `provider_user_id` varchar(255) NOT NULL,
  `provider_data` TEXT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL,
  
  FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (`provider`, `provider_user_id`)
);

-- Create index for faster lookups
CREATE INDEX idx_oauth_user_id ON oauth_providers (`user_id`);

-- Create a migration function to move existing OAuth data
INSERT INTO oauth_providers (user_id, provider, provider_user_id, provider_data)
SELECT id, oauth_provider, oauth_id, oauth_data
FROM user
WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL;

-- Keep the columns for backward compatibility during transition
-- These can be removed in a future migration after the code has been updated
-- ALTER TABLE user DROP COLUMN oauth_provider;
-- ALTER TABLE user DROP COLUMN oauth_id;
-- ALTER TABLE user DROP COLUMN oauth_data;