CREATE TABLE `share` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL UNIQUE,
    "issuer_user_id" INTEGER NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "data" JSON DEFAULT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY ("issuer_user_id") REFERENCES "user" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
