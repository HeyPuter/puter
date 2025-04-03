CREATE TABLE `per_user_credit` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `user_id` INTEGER NOT NULL UNIQUE,
    `amount` int NOT NULL,
    
    -- NOTE: "BIGINT UNSIGNED"
    `last_updated_at` INTEGER NOT NULL,
    
    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("app_id") REFERENCES "apps" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
