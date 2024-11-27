CREATE TABLE `ai_usage` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `user_id` INTEGER NOT NULL,
    `app_id` INTEGER DEFAULT NULL,
    `service_name` TEXT NOT NULL,
    `model_name` TEXT NOT NULL,
    
    -- set this to a string when service:model alone does not make
    -- the numeric values below fungible
    `price_modifier` TEXT DEFAULT NULL,

    -- expected cost of request in µ¢ (microcents)
    `cost` int DEFAULT NULL,

    -- input tokens
    `value_uint_1` int DEFAULT NULL,
    -- output tokens
    `value_uint_2` int DEFAULT NULL,
    
    -- miscelaneous values for future use
    `value_uint_3` int DEFAULT NULL,
    `value_uint_4` int DEFAULT NULL,
    `value_uint_5` int DEFAULT NULL,

    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("app_id") REFERENCES "apps" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX `idx_ai_usage_service_name` ON `ai_usage` (`service_name`);
CREATE INDEX `idx_ai_usage_model_name` ON `ai_usage` (`model_name`);
CREATE INDEX `idx_ai_usage_price_modifier` ON `ai_usage` (`price_modifier`);
CREATE INDEX `idx_ai_usage_created_at` ON `ai_usage` (`created_at`);
