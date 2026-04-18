CREATE TABLE `user_to_group_permissions` (
    "user_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,
    "permission" TEXT NOT NULL,
    "extra" JSON DEFAULT NULL,

    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("group_id") REFERENCES "group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("user_id", "group_id", "permission")
);

CREATE TABLE "audit_user_to_group_permissions" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,

    "user_id" INTEGER NOT NULL,
    "user_id_keep" INTEGER DEFAULT NULL,

    "group_id" INTEGER NOT NULL,
    "group_id_keep" INTEGER DEFAULT NULL,

    "permission" TEXT NOT NULL,
    "extra" JSON DEFAULT NULL,

    "action" TEXT DEFAULT NULL,
    "reason" TEXT DEFAULT NULL,

    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY("group_id") REFERENCES "group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
