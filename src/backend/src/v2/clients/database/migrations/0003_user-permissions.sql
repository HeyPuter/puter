CREATE TABLE `user_to_user_permissions` (
    "issuer_user_id" INTEGER NOT NULL,
    "holder_user_id" INTEGER NOT NULL,
    "permission" TEXT NOT NULL,
    "extra" JSON DEFAULT NULL,

    FOREIGN KEY("issuer_user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("holder_user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("issuer_user_id", "holder_user_id", "permission")
);

CREATE TABLE "audit_user_to_user_permissions" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,

    "issuer_user_id" INTEGER NOT NULL,
    "issuer_user_id_keep" INTEGER DEFAULT NULL,

    "holder_user_id" INTEGER NOT NULL,
    "holder_user_id_keep" INTEGER DEFAULT NULL,

    "permission" TEXT NOT NULL,
    "extra" JSON DEFAULT NULL,

    "action" TEXT DEFAULT NULL,
    "reason" TEXT DEFAULT NULL,

    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY("issuer_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY("holder_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
