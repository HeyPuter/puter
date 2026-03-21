CREATE TABLE IF NOT EXISTS `upload_sessions` (
  `id` INTEGER PRIMARY KEY,
  `uid` char(36) NOT NULL UNIQUE,
  `user_id` int(10) NOT NULL,
  `app_id` int(10) DEFAULT NULL,
  `parent_uid` char(36) NOT NULL,
  `parent_path` varchar(4096) NOT NULL,
  `target_name` varchar(767) NOT NULL,
  `target_path` varchar(4096) NOT NULL,
  `overwrite_target_uid` char(36) DEFAULT NULL,
  `content_type` varchar(255) NOT NULL,
  `size` bigint(20) NOT NULL,
  `checksum_sha256` char(64) DEFAULT NULL,
  `upload_mode` varchar(16) NOT NULL,
  `multipart_upload_id` varchar(255) DEFAULT NULL,
  `multipart_part_size` bigint(20) DEFAULT NULL,
  `multipart_part_count` int(10) DEFAULT NULL,
  `storage_provider` varchar(64) NOT NULL,
  `bucket` varchar(255) DEFAULT NULL,
  `bucket_region` varchar(64) DEFAULT NULL,
  `staging_key` varchar(1024) NOT NULL,
  `status` varchar(32) NOT NULL,
  `failure_reason` varchar(255) DEFAULT NULL,
  `metadata_json` text,
  `created_at` int(10) NOT NULL,
  `updated_at` int(10) NOT NULL,
  `expires_at` int(10) NOT NULL,
  `consumed_at` int(10) DEFAULT NULL,
  `completed_at` int(10) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_user_status ON upload_sessions (`user_id`, `status`);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires ON upload_sessions (`expires_at`);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status_updated ON upload_sessions (`status`, `updated_at`);
