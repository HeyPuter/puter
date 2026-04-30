-- Store IP and request data as TEXT (for JSON strings)
ALTER TABLE `user` ADD COLUMN `signup_ip` TEXT DEFAULT NULL;
ALTER TABLE `user` ADD COLUMN `signup_ip_forwarded` TEXT DEFAULT NULL;
ALTER TABLE `user` ADD COLUMN `signup_user_agent` TEXT DEFAULT NULL;
ALTER TABLE `user` ADD COLUMN `signup_origin` TEXT DEFAULT NULL;
ALTER TABLE `user` ADD COLUMN `signup_server` TEXT DEFAULT NULL;

-- Add indexes for columns likely to be searched
CREATE INDEX idx_user_signup_ip ON user(signup_ip);
CREATE INDEX idx_user_signup_ip_forwarded ON user(signup_ip_forwarded);
CREATE INDEX idx_user_signup_user_agent ON user(signup_user_agent);
CREATE INDEX idx_user_signup_origin ON user(signup_origin);
CREATE INDEX idx_user_signup_server ON user(signup_server);
