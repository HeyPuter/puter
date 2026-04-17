ALTER TABLE `user` ADD COLUMN `clean_email` varchar(256) DEFAULT NULL;
CREATE INDEX idx_user_clean_email ON `user` (`clean_email`);
