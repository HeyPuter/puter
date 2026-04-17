PRAGMA foreign_keys = OFF;

CREATE TABLE user_to_app_permissions_new (
  user_id     INTEGER NOT NULL,
  app_id      INTEGER NOT NULL,
  permission  VARCHAR(255) NOT NULL,
  extra       JSON DEFAULT NULL,
  dt          DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (app_id)  REFERENCES apps(id) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (user_id, app_id, permission)
);

INSERT INTO user_to_app_permissions_new (user_id, app_id, permission, extra, dt)
SELECT user_id, app_id, permission, extra, NULL
FROM user_to_app_permissions;

DROP TABLE user_to_app_permissions;
ALTER TABLE user_to_app_permissions_new RENAME TO user_to_app_permissions;

PRAGMA foreign_keys = ON;