-- MySQL dump 10.13  Distrib 8.0.46, for macos15 (arm64)
--
-- Host: puter-db.ctcdlrc15nt3.us-west-2.rds.amazonaws.com    Database: filecream
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '';

--
-- Idempotent column-ensure helper (used by CALLs below; dropped at end of file)
--

DROP PROCEDURE IF EXISTS _puter_add_col;
DELIMITER //
CREATE PROCEDURE _puter_add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN def TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = tbl
      AND COLUMN_NAME  = col
  ) THEN
    SET @s := CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', def);
    PREPARE stmt FROM @s;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

--
-- Table structure for table `access_token_permissions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `access_token_permissions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `token_uid` char(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `authorizer_user_id` int unsigned DEFAULT NULL,
  `authorizer_app_id` int unsigned DEFAULT NULL,
  `permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `extra` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=43870 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('access_token_permissions', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('access_token_permissions', 'token_uid', '`token_uid` char(40) COLLATE utf8mb4_unicode_ci NOT NULL');
CALL _puter_add_col('access_token_permissions', 'authorizer_user_id', '`authorizer_user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('access_token_permissions', 'authorizer_app_id', '`authorizer_app_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('access_token_permissions', 'permission', '`permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('access_token_permissions', 'extra', '`extra` json DEFAULT NULL');
CALL _puter_add_col('access_token_permissions', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `ai_usage`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `ai_usage` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `app_id` int unsigned DEFAULT NULL,
  `service_name` char(64) DEFAULT NULL,
  `model_name` char(128) DEFAULT NULL,
  `price_modifier` char(40) DEFAULT NULL,
  `cost` int DEFAULT NULL,
  `value_uint_1` int unsigned DEFAULT NULL,
  `value_uint_2` int unsigned DEFAULT NULL,
  `value_uint_3` int unsigned DEFAULT NULL,
  `value_uint_4` int unsigned DEFAULT NULL,
  `value_uint_5` int unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `app_id` (`app_id`),
  KEY `idx_ai_usage_service_name` (`service_name`),
  KEY `idx_ai_usage_model_name` (`model_name`),
  KEY `idx_ai_usage_price_modifier` (`price_modifier`),
  KEY `idx_ai_usage_created_at` (`created_at`),
  KEY `idx_ai_usage_user_timestamp` (`user_id`,`created_at`),
  CONSTRAINT `ai_usage_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ai_usage_ibfk_2` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=935038 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('ai_usage', 'id', '`id` int NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('ai_usage', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('ai_usage', 'app_id', '`app_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'service_name', '`service_name` char(64) DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'model_name', '`model_name` char(128) DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'price_modifier', '`price_modifier` char(40) DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'cost', '`cost` int DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'value_uint_1', '`value_uint_1` int unsigned DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'value_uint_2', '`value_uint_2` int unsigned DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'value_uint_3', '`value_uint_3` int unsigned DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'value_uint_4', '`value_uint_4` int unsigned DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'value_uint_5', '`value_uint_5` int unsigned DEFAULT NULL');
CALL _puter_add_col('ai_usage', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `app_filetype_association`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `app_filetype_association` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `app_id` int unsigned NOT NULL,
  `type` varchar(60) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `app_id` (`app_id`),
  KEY `type` (`type`),
  CONSTRAINT `app_filetype_association_ibfk_1` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=28897 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('app_filetype_association', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('app_filetype_association', 'app_id', '`app_id` int unsigned NOT NULL');
CALL _puter_add_col('app_filetype_association', 'type', '`type` varchar(60) NOT NULL');

--
-- Table structure for table `app_opens`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `app_opens` (
  `_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `app_uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  `user_id` int unsigned NOT NULL,
  `ts` int unsigned NOT NULL,
  `human_ts` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`_id`),
  KEY `user_id` (`user_id`),
  KEY `app_uid` (`app_uid`),
  KEY `idx_app_opens_uid_ts` (`app_uid`,`ts`),
  KEY `idx_app_opens_app_user` (`app_uid`,`user_id`),
  CONSTRAINT `app_opens_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `app_opens_ibfk_3` FOREIGN KEY (`app_uid`) REFERENCES `apps` (`uid`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=14510891 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('app_opens', '_id', '`_id` bigint unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('app_opens', 'app_uid', '`app_uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL');
CALL _puter_add_col('app_opens', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('app_opens', 'ts', '`ts` int unsigned NOT NULL');
CALL _puter_add_col('app_opens', 'human_ts', '`human_ts` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `app_update_audit`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `app_update_audit` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `app_id` int unsigned DEFAULT NULL,
  `app_id_keep` int unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `old_name` varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `new_name` varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_app_update_audit_app_id` (`app_id`),
  CONSTRAINT `fk_app_update_audit_app_id` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('app_update_audit', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('app_update_audit', 'app_id', '`app_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('app_update_audit', 'app_id_keep', '`app_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('app_update_audit', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL _puter_add_col('app_update_audit', 'old_name', '`old_name` varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('app_update_audit', 'new_name', '`new_name` varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('app_update_audit', 'reason', '`reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');

--
-- Table structure for table `apps`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `apps` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  `owner_user_id` int unsigned DEFAULT NULL,
  `icon` longtext,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  `godmode` tinyint(1) DEFAULT '0',
  `maximize_on_start` tinyint(1) DEFAULT '0',
  `index_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `approved_for_listing` tinyint(1) DEFAULT '0',
  `approved_for_opening_items` tinyint(1) DEFAULT '0',
  `approved_for_incentive_program` tinyint(1) DEFAULT '0',
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_review` timestamp NULL DEFAULT NULL,
  `tags` varchar(255) DEFAULT NULL,
  `app_owner` int unsigned DEFAULT NULL,
  `background` tinyint(1) DEFAULT '0',
  `metadata` json DEFAULT NULL,
  `protected` tinyint(1) DEFAULT '0',
  `is_private` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uid` (`uid`),
  UNIQUE KEY `name` (`name`),
  KEY `owner_user_id` (`owner_user_id`),
  KEY `fk_apps_app_owner` (`app_owner`),
  KEY `idx_apps_owner_timestamp` (`owner_user_id`,`timestamp` DESC),
  KEY `idx_apps_listing_timestamp` (`approved_for_listing`,`timestamp` DESC),
  CONSTRAINT `apps_ibfk_1` FOREIGN KEY (`owner_user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_apps_app_owner` FOREIGN KEY (`app_owner`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=169455 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('apps', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('apps', 'uid', '`uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL');
CALL _puter_add_col('apps', 'owner_user_id', '`owner_user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('apps', 'icon', '`icon` longtext');
CALL _puter_add_col('apps', 'name', '`name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL');
CALL _puter_add_col('apps', 'title', '`title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL');
CALL _puter_add_col('apps', 'description', '`description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
CALL _puter_add_col('apps', 'godmode', '`godmode` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('apps', 'maximize_on_start', '`maximize_on_start` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('apps', 'index_url', '`index_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL');
CALL _puter_add_col('apps', 'approved_for_listing', '`approved_for_listing` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('apps', 'approved_for_opening_items', '`approved_for_opening_items` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('apps', 'approved_for_incentive_program', '`approved_for_incentive_program` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('apps', 'timestamp', '`timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL _puter_add_col('apps', 'last_review', '`last_review` timestamp NULL DEFAULT NULL');
CALL _puter_add_col('apps', 'tags', '`tags` varchar(255) DEFAULT NULL');
CALL _puter_add_col('apps', 'app_owner', '`app_owner` int unsigned DEFAULT NULL');
CALL _puter_add_col('apps', 'background', '`background` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('apps', 'metadata', '`metadata` json DEFAULT NULL');
CALL _puter_add_col('apps', 'protected', '`protected` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('apps', 'is_private', '`is_private` tinyint(1) DEFAULT ''0''');

--
-- Table structure for table `audit_dev_to_app_permissions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `audit_dev_to_app_permissions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned DEFAULT NULL,
  `user_id_keep` int unsigned NOT NULL,
  `app_id` int unsigned DEFAULT NULL,
  `app_id_keep` int unsigned NOT NULL,
  `permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `extra` json DEFAULT NULL,
  `action` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_audit_dev_to_app_permissions_user_id` (`user_id`),
  KEY `fk_audit_dev_to_app_permissions_app_id` (`app_id`),
  CONSTRAINT `fk_audit_dev_to_app_permissions_app_id` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_audit_dev_to_app_permissions_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('audit_dev_to_app_permissions', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('audit_dev_to_app_permissions', 'user_id', '`user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('audit_dev_to_app_permissions', 'user_id_keep', '`user_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('audit_dev_to_app_permissions', 'app_id', '`app_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('audit_dev_to_app_permissions', 'app_id_keep', '`app_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('audit_dev_to_app_permissions', 'permission', '`permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('audit_dev_to_app_permissions', 'extra', '`extra` json DEFAULT NULL');
CALL _puter_add_col('audit_dev_to_app_permissions', 'action', '`action` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('audit_dev_to_app_permissions', 'reason', '`reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('audit_dev_to_app_permissions', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `audit_user_to_app_permissions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `audit_user_to_app_permissions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned DEFAULT NULL,
  `user_id_keep` int unsigned NOT NULL,
  `app_id` int unsigned DEFAULT NULL,
  `app_id_keep` int unsigned NOT NULL,
  `permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `extra` json DEFAULT NULL,
  `action` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_audit_user_to_app_permissions_user_id` (`user_id`),
  KEY `fk_audit_user_to_app_permissions_app_id` (`app_id`),
  CONSTRAINT `fk_audit_user_to_app_permissions_app_id` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_audit_user_to_app_permissions_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7352860 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('audit_user_to_app_permissions', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('audit_user_to_app_permissions', 'user_id', '`user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('audit_user_to_app_permissions', 'user_id_keep', '`user_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('audit_user_to_app_permissions', 'app_id', '`app_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('audit_user_to_app_permissions', 'app_id_keep', '`app_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('audit_user_to_app_permissions', 'permission', '`permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('audit_user_to_app_permissions', 'extra', '`extra` json DEFAULT NULL');
CALL _puter_add_col('audit_user_to_app_permissions', 'action', '`action` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('audit_user_to_app_permissions', 'reason', '`reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('audit_user_to_app_permissions', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `audit_user_to_group_permissions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `audit_user_to_group_permissions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned DEFAULT NULL,
  `user_id_keep` int unsigned NOT NULL,
  `group_id` int unsigned DEFAULT NULL,
  `group_id_keep` int unsigned NOT NULL,
  `permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `extra` json DEFAULT NULL,
  `action` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `group_id` (`group_id`),
  CONSTRAINT `audit_user_to_group_permissions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `audit_user_to_group_permissions_ibfk_2` FOREIGN KEY (`group_id`) REFERENCES `group` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('audit_user_to_group_permissions', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('audit_user_to_group_permissions', 'user_id', '`user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('audit_user_to_group_permissions', 'user_id_keep', '`user_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('audit_user_to_group_permissions', 'group_id', '`group_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('audit_user_to_group_permissions', 'group_id_keep', '`group_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('audit_user_to_group_permissions', 'permission', '`permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('audit_user_to_group_permissions', 'extra', '`extra` json DEFAULT NULL');
CALL _puter_add_col('audit_user_to_group_permissions', 'action', '`action` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('audit_user_to_group_permissions', 'reason', '`reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('audit_user_to_group_permissions', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `audit_user_to_user_permissions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `audit_user_to_user_permissions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `issuer_user_id` int unsigned DEFAULT NULL,
  `issuer_user_id_keep` int unsigned NOT NULL,
  `holder_user_id` int unsigned DEFAULT NULL,
  `holder_user_id_keep` int unsigned NOT NULL,
  `permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `extra` json DEFAULT NULL,
  `action` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_audit_user_to_user_permissions_issuer_user_id` (`issuer_user_id`),
  KEY `fk_audit_user_to_user_permissions_holder_user_id` (`holder_user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=981 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('audit_user_to_user_permissions', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('audit_user_to_user_permissions', 'issuer_user_id', '`issuer_user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('audit_user_to_user_permissions', 'issuer_user_id_keep', '`issuer_user_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('audit_user_to_user_permissions', 'holder_user_id', '`holder_user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('audit_user_to_user_permissions', 'holder_user_id_keep', '`holder_user_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('audit_user_to_user_permissions', 'permission', '`permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('audit_user_to_user_permissions', 'extra', '`extra` json DEFAULT NULL');
CALL _puter_add_col('audit_user_to_user_permissions', 'action', '`action` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('audit_user_to_user_permissions', 'reason', '`reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('audit_user_to_user_permissions', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');


--
-- Table structure for table `dev_to_app_permissions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `dev_to_app_permissions` (
  `user_id` int unsigned NOT NULL,
  `app_id` int unsigned NOT NULL,
  `permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `extra` json DEFAULT NULL,
  PRIMARY KEY (`user_id`,`app_id`,`permission`),
  KEY `fk_dev_to_app_permissions_app_id` (`app_id`),
  KEY `idx_dev_app_perms_permission` (`permission`),
  CONSTRAINT `fk_dev_to_app_permissions_app_id` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_dev_to_app_permissions_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('dev_to_app_permissions', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('dev_to_app_permissions', 'app_id', '`app_id` int unsigned NOT NULL');
CALL _puter_add_col('dev_to_app_permissions', 'permission', '`permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('dev_to_app_permissions', 'extra', '`extra` json DEFAULT NULL');

--
-- Table structure for table `feedback`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `feedback` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `message` text,
  `ts` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `feedback_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=815 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('feedback', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('feedback', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('feedback', 'message', '`message` text');
CALL _puter_add_col('feedback', 'ts', '`ts` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `fsentries`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `fsentries` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  `bucket` varchar(50) DEFAULT NULL,
  `bucket_region` varchar(30) DEFAULT NULL,
  `public_token` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `file_request_token` char(36) DEFAULT NULL,
  `is_shortcut` tinyint(1) DEFAULT '0',
  `shortcut_to` int unsigned DEFAULT NULL,
  `user_id` int unsigned NOT NULL,
  `parent_id` int unsigned DEFAULT NULL,
  `associated_app_id` int unsigned DEFAULT NULL,
  `is_dir` tinyint(1) DEFAULT '0',
  `layout` varchar(30) DEFAULT NULL,
  `sort_by` enum('name','modified','type','size') DEFAULT NULL,
  `sort_order` enum('asc','desc') DEFAULT NULL,
  `is_public` tinyint(1) DEFAULT NULL,
  `thumbnail` longtext,
  `immutable` tinyint(1) NOT NULL DEFAULT '0',
  `name` varchar(767) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `metadata` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `modified` int unsigned NOT NULL,
  `created` int unsigned DEFAULT NULL,
  `accessed` int unsigned DEFAULT NULL,
  `size` bigint DEFAULT NULL,
  `symlink_path` varchar(260) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `is_symlink` tinyint(1) DEFAULT '0',
  `parent_uid` char(36) DEFAULT NULL,
  `path` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`) USING BTREE,
  UNIQUE KEY `parent_id_filename` (`parent_id`,`name`) USING BTREE,
  UNIQUE KEY `public_token` (`public_token`) USING BTREE,
  UNIQUE KEY `file_request_token` (`file_request_token`),
  KEY `filename` (`name`),
  KEY `modified` (`modified`),
  KEY `parent_id` (`parent_id`),
  KEY `is_dir` (`is_dir`),
  KEY `user_id` (`user_id`) USING BTREE,
  KEY `shortcut_to` (`shortcut_to`),
  KEY `associated_app_id` (`associated_app_id`),
  KEY `bucket` (`bucket`),
  KEY `bucket_region` (`bucket_region`),
  KEY `parent_uid` (`parent_uid`),
  KEY `idx_fsentries_path` (`path`(767)),
  KEY `idx_fsentries_accessed` (`accessed`),
  KEY `idx_fsentries_user_parent_name` (`user_id`,`parent_uid`,`name`(191)),
  KEY `idx_fsentries_parent_uid_name` (`parent_uid`,`name`(191)),
  CONSTRAINT `fsentries_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fsentries_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `fsentries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fsentries_ibfk_3` FOREIGN KEY (`shortcut_to`) REFERENCES `fsentries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fsentries_ibfk_4` FOREIGN KEY (`associated_app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=37893498 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('fsentries', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('fsentries', 'uuid', '`uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL');
CALL _puter_add_col('fsentries', 'bucket', '`bucket` varchar(50) DEFAULT NULL');
CALL _puter_add_col('fsentries', 'bucket_region', '`bucket_region` varchar(30) DEFAULT NULL');
CALL _puter_add_col('fsentries', 'public_token', '`public_token` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('fsentries', 'file_request_token', '`file_request_token` char(36) DEFAULT NULL');
CALL _puter_add_col('fsentries', 'is_shortcut', '`is_shortcut` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('fsentries', 'shortcut_to', '`shortcut_to` int unsigned DEFAULT NULL');
CALL _puter_add_col('fsentries', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('fsentries', 'parent_id', '`parent_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('fsentries', 'associated_app_id', '`associated_app_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('fsentries', 'is_dir', '`is_dir` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('fsentries', 'layout', '`layout` varchar(30) DEFAULT NULL');
CALL _puter_add_col('fsentries', 'sort_by', '`sort_by` enum(''name'',''modified'',''type'',''size'') DEFAULT NULL');
CALL _puter_add_col('fsentries', 'sort_order', '`sort_order` enum(''asc'',''desc'') DEFAULT NULL');
CALL _puter_add_col('fsentries', 'is_public', '`is_public` tinyint(1) DEFAULT NULL');
CALL _puter_add_col('fsentries', 'thumbnail', '`thumbnail` longtext');
CALL _puter_add_col('fsentries', 'immutable', '`immutable` tinyint(1) NOT NULL DEFAULT ''0''');
CALL _puter_add_col('fsentries', 'name', '`name` varchar(767) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL');
CALL _puter_add_col('fsentries', 'metadata', '`metadata` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
CALL _puter_add_col('fsentries', 'modified', '`modified` int unsigned NOT NULL');
CALL _puter_add_col('fsentries', 'created', '`created` int unsigned DEFAULT NULL');
CALL _puter_add_col('fsentries', 'accessed', '`accessed` int unsigned DEFAULT NULL');
CALL _puter_add_col('fsentries', 'size', '`size` bigint DEFAULT NULL');
CALL _puter_add_col('fsentries', 'symlink_path', '`symlink_path` varchar(260) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL');
CALL _puter_add_col('fsentries', 'is_symlink', '`is_symlink` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('fsentries', 'parent_uid', '`parent_uid` char(36) DEFAULT NULL');
CALL _puter_add_col('fsentries', 'path', '`path` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL');

--
-- Table structure for table `fsentry_versions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `fsentry_versions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `fsentry_id` int unsigned NOT NULL,
  `fsentry_uuid` char(36) NOT NULL,
  `version_id` varchar(60) NOT NULL,
  `user_id` int unsigned DEFAULT NULL,
  `message` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  `ts_epoch` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fsentry_id` (`fsentry_id`),
  KEY `fsentry_uuid` (`fsentry_uuid`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `fsentry_versions_ibfk_1` FOREIGN KEY (`fsentry_id`) REFERENCES `fsentries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fsentry_versions_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=24662498 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('fsentry_versions', 'id', '`id` bigint NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('fsentry_versions', 'fsentry_id', '`fsentry_id` int unsigned NOT NULL');
CALL _puter_add_col('fsentry_versions', 'fsentry_uuid', '`fsentry_uuid` char(36) NOT NULL');
CALL _puter_add_col('fsentry_versions', 'version_id', '`version_id` varchar(60) NOT NULL');
CALL _puter_add_col('fsentry_versions', 'user_id', '`user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('fsentry_versions', 'message', '`message` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
CALL _puter_add_col('fsentry_versions', 'ts_epoch', '`ts_epoch` int unsigned DEFAULT NULL');

--
-- Table structure for table `general_analytics`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `general_analytics` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `uid` char(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `trace_id` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_id` int unsigned DEFAULT NULL,
  `user_id_keep` int unsigned DEFAULT NULL,
  `app_id` int unsigned DEFAULT NULL,
  `app_id_keep` int unsigned DEFAULT NULL,
  `server_id` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actor_type` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tags` json DEFAULT NULL,
  `fields` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_general_analytics_user_id` (`user_id`),
  KEY `fk_general_analytics_app_id` (`app_id`),
  CONSTRAINT `fk_general_analytics_app_id` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_general_analytics_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('general_analytics', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('general_analytics', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL _puter_add_col('general_analytics', 'uid', '`uid` char(40) COLLATE utf8mb4_unicode_ci NOT NULL');
CALL _puter_add_col('general_analytics', 'trace_id', '`trace_id` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('general_analytics', 'user_id', '`user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('general_analytics', 'user_id_keep', '`user_id_keep` int unsigned DEFAULT NULL');
CALL _puter_add_col('general_analytics', 'app_id', '`app_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('general_analytics', 'app_id_keep', '`app_id_keep` int unsigned DEFAULT NULL');
CALL _puter_add_col('general_analytics', 'server_id', '`server_id` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('general_analytics', 'actor_type', '`actor_type` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('general_analytics', 'tags', '`tags` json DEFAULT NULL');
CALL _puter_add_col('general_analytics', 'fields', '`fields` json DEFAULT NULL');

--
-- Table structure for table `group`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `group` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `uid` char(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `owner_user_id` int unsigned DEFAULT NULL,
  `extra` json DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uid` (`uid`),
  KEY `owner_user_id` (`owner_user_id`),
  CONSTRAINT `group_ibfk_1` FOREIGN KEY (`owner_user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('group', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('group', 'uid', '`uid` char(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('group', 'owner_user_id', '`owner_user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('group', 'extra', '`extra` json DEFAULT NULL');
CALL _puter_add_col('group', 'metadata', '`metadata` json DEFAULT NULL');
CALL _puter_add_col('group', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `jct_user_group`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `jct_user_group` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `group_id` int unsigned NOT NULL,
  `extra` json DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `group_id` (`group_id`),
  CONSTRAINT `jct_user_group_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `jct_user_group_ibfk_2` FOREIGN KEY (`group_id`) REFERENCES `group` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3513197 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('jct_user_group', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('jct_user_group', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('jct_user_group', 'group_id', '`group_id` int unsigned NOT NULL');
CALL _puter_add_col('jct_user_group', 'extra', '`extra` json DEFAULT NULL');
CALL _puter_add_col('jct_user_group', 'metadata', '`metadata` json DEFAULT NULL');
CALL _puter_add_col('jct_user_group', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `kv`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `kv` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `app` char(40) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
  `user_id` int unsigned NOT NULL,
  `kkey_hash` bigint unsigned NOT NULL,
  `kkey` text NOT NULL,
  `value` text,
  `migrated` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `app_2` (`app`,`user_id`,`kkey_hash`),
  KEY `app` (`app`),
  KEY `user_id` (`user_id`),
  KEY `kkey_hash` (`kkey_hash`),
  CONSTRAINT `kv_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=101649 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('kv', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('kv', 'app', '`app` char(40) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL');
CALL _puter_add_col('kv', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('kv', 'kkey_hash', '`kkey_hash` bigint unsigned NOT NULL');
CALL _puter_add_col('kv', 'kkey', '`kkey` text NOT NULL');
CALL _puter_add_col('kv', 'value', '`value` text');
CALL _puter_add_col('kv', 'migrated', '`migrated` tinyint(1) DEFAULT ''0''');

--
-- Table structure for table `monthly_usage_counts`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `monthly_usage_counts` (
  `year` int unsigned NOT NULL,
  `month` int unsigned NOT NULL,
  `service_type` varchar(40) NOT NULL,
  `service_name` varchar(40) NOT NULL,
  `actor_key` varchar(255) NOT NULL,
  `pricing_category` json NOT NULL,
  `pricing_category_hash` binary(20) NOT NULL,
  `count` int unsigned DEFAULT '0',
  `value_uint_1` int unsigned DEFAULT NULL,
  `value_uint_2` int unsigned DEFAULT NULL,
  `value_uint_3` int unsigned DEFAULT NULL,
  PRIMARY KEY (`year`,`month`,`service_type`,`service_name`,`actor_key`,`pricing_category_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('monthly_usage_counts', 'year', '`year` int unsigned NOT NULL');
CALL _puter_add_col('monthly_usage_counts', 'month', '`month` int unsigned NOT NULL');
CALL _puter_add_col('monthly_usage_counts', 'service_type', '`service_type` varchar(40) NOT NULL');
CALL _puter_add_col('monthly_usage_counts', 'service_name', '`service_name` varchar(40) NOT NULL');
CALL _puter_add_col('monthly_usage_counts', 'actor_key', '`actor_key` varchar(255) NOT NULL');
CALL _puter_add_col('monthly_usage_counts', 'pricing_category', '`pricing_category` json NOT NULL');
CALL _puter_add_col('monthly_usage_counts', 'pricing_category_hash', '`pricing_category_hash` binary(20) NOT NULL');
CALL _puter_add_col('monthly_usage_counts', 'count', '`count` int unsigned DEFAULT ''0''');
CALL _puter_add_col('monthly_usage_counts', 'value_uint_1', '`value_uint_1` int unsigned DEFAULT NULL');
CALL _puter_add_col('monthly_usage_counts', 'value_uint_2', '`value_uint_2` int unsigned DEFAULT NULL');
CALL _puter_add_col('monthly_usage_counts', 'value_uint_3', '`value_uint_3` int unsigned DEFAULT NULL');

--
-- Table structure for table `notification`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `notification` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `uid` char(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `value` json NOT NULL,
  `acknowledged` tinyint(1) DEFAULT NULL,
  `shown` tinyint(1) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uid` (`uid`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `notification_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=164238 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('notification', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('notification', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('notification', 'uid', '`uid` char(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('notification', 'value', '`value` json NOT NULL');
CALL _puter_add_col('notification', 'acknowledged', '`acknowledged` tinyint(1) DEFAULT NULL');
CALL _puter_add_col('notification', 'shown', '`shown` tinyint(1) DEFAULT NULL');
CALL _puter_add_col('notification', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `old_app_names`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `old_app_names` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `app_uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `app_uid` (`app_uid`),
  KEY `old_app_names_app_name` (`name`),
  CONSTRAINT `old_app_names_ibfk_1` FOREIGN KEY (`app_uid`) REFERENCES `apps` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=45405 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('old_app_names', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('old_app_names', 'app_uid', '`app_uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL');
CALL _puter_add_col('old_app_names', 'name', '`name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL');
CALL _puter_add_col('old_app_names', 'timestamp', '`timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `per_user_credit`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `per_user_credit` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `amount` bigint NOT NULL,
  `last_updated_at` bigint unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `per_user_credit_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=388003 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('per_user_credit', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('per_user_credit', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('per_user_credit', 'amount', '`amount` bigint NOT NULL');
CALL _puter_add_col('per_user_credit', 'last_updated_at', '`last_updated_at` bigint unsigned NOT NULL');

--
-- Table structure for table `service_usage_monthly`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `service_usage_monthly` (
  `key` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `year` int unsigned NOT NULL,
  `month` int unsigned NOT NULL,
  `user_id` int unsigned DEFAULT NULL,
  `app_id` int unsigned DEFAULT NULL,
  `count` int unsigned NOT NULL,
  `extra` json DEFAULT NULL,
  PRIMARY KEY (`key`,`year`,`month`),
  KEY `fk_service_usage_monthly_user_id` (`user_id`),
  KEY `fk_service_usage_monthly_app_id` (`app_id`),
  CONSTRAINT `fk_service_usage_monthly_app_id` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_service_usage_monthly_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('service_usage_monthly', 'key', '`key` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('service_usage_monthly', 'year', '`year` int unsigned NOT NULL');
CALL _puter_add_col('service_usage_monthly', 'month', '`month` int unsigned NOT NULL');
CALL _puter_add_col('service_usage_monthly', 'user_id', '`user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('service_usage_monthly', 'app_id', '`app_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('service_usage_monthly', 'count', '`count` int unsigned NOT NULL');
CALL _puter_add_col('service_usage_monthly', 'extra', '`extra` json DEFAULT NULL');

--
-- Table structure for table `sessions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `uuid` char(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `meta` json DEFAULT NULL,
  `created_at` bigint DEFAULT '0',
  `last_activity` bigint DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `fk_sessions_user_id` (`user_id`),
  KEY `uuid` (`uuid`),
  CONSTRAINT `fk_sessions_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2293466 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('sessions', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('sessions', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('sessions', 'uuid', '`uuid` char(40) COLLATE utf8mb4_unicode_ci NOT NULL');
CALL _puter_add_col('sessions', 'meta', '`meta` json DEFAULT NULL');
CALL _puter_add_col('sessions', 'created_at', '`created_at` bigint DEFAULT ''0''');
CALL _puter_add_col('sessions', 'last_activity', '`last_activity` bigint DEFAULT ''0''');

--
-- Table structure for table `share`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `share` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `uid` char(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `issuer_user_id` int unsigned NOT NULL,
  `recipient_email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uid` (`uid`),
  KEY `issuer_user_id` (`issuer_user_id`),
  KEY `recipient_email` (`recipient_email`),
  CONSTRAINT `share_ibfk_1` FOREIGN KEY (`issuer_user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('share', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('share', 'uid', '`uid` char(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('share', 'issuer_user_id', '`issuer_user_id` int unsigned NOT NULL');
CALL _puter_add_col('share', 'recipient_email', '`recipient_email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL');
CALL _puter_add_col('share', 'data', '`data` json DEFAULT NULL');
CALL _puter_add_col('share', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `storage_audit`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `storage_audit` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned DEFAULT NULL,
  `user_id_keep` int unsigned NOT NULL,
  `is_subtract` tinyint(1) NOT NULL DEFAULT '0',
  `amount` bigint unsigned NOT NULL,
  `field_a` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `field_b` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_storage_audit_user_id` (`user_id`),
  CONSTRAINT `fk_storage_audit_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22080 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('storage_audit', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('storage_audit', 'user_id', '`user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('storage_audit', 'user_id_keep', '`user_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('storage_audit', 'is_subtract', '`is_subtract` tinyint(1) NOT NULL DEFAULT ''0''');
CALL _puter_add_col('storage_audit', 'amount', '`amount` bigint unsigned NOT NULL');
CALL _puter_add_col('storage_audit', 'field_a', '`field_a` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('storage_audit', 'field_b', '`field_b` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('storage_audit', 'reason', '`reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('storage_audit', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `subdomains`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `subdomains` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `uuid` varchar(40) DEFAULT NULL,
  `subdomain` varchar(64) NOT NULL,
  `user_id` int unsigned NOT NULL,
  `root_dir_id` int unsigned DEFAULT NULL,
  `associated_app_id` int unsigned DEFAULT NULL,
  `ts` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `app_owner` int unsigned DEFAULT NULL,
  `protected` tinyint(1) DEFAULT '0',
  `domain` varchar(265) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `subdomain` (`subdomain`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `user_id` (`user_id`),
  KEY `root_dir` (`root_dir_id`),
  KEY `associated_app_id` (`associated_app_id`),
  KEY `fk_subdomains_app_owner` (`app_owner`),
  KEY `idx_subdomains_domain` (`domain`),
  KEY `idx_subdomains_root_user` (`root_dir_id`,`user_id`),
  KEY `idx_subdomains_app_user` (`associated_app_id`,`user_id`),
  CONSTRAINT `fk_subdomains_app_owner` FOREIGN KEY (`app_owner`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `subdomains_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `subdomains_ibfk_2` FOREIGN KEY (`root_dir_id`) REFERENCES `fsentries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `subdomains_ibfk_3` FOREIGN KEY (`associated_app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=171443 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('subdomains', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('subdomains', 'uuid', '`uuid` varchar(40) DEFAULT NULL');
CALL _puter_add_col('subdomains', 'subdomain', '`subdomain` varchar(64) NOT NULL');
CALL _puter_add_col('subdomains', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('subdomains', 'root_dir_id', '`root_dir_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('subdomains', 'associated_app_id', '`associated_app_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('subdomains', 'ts', '`ts` timestamp NULL DEFAULT CURRENT_TIMESTAMP');
CALL _puter_add_col('subdomains', 'app_owner', '`app_owner` int unsigned DEFAULT NULL');
CALL _puter_add_col('subdomains', 'protected', '`protected` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('subdomains', 'domain', '`domain` varchar(265) DEFAULT NULL');

--
-- Table structure for table `thread`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `thread` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `uid` char(40) NOT NULL,
  `parent_uid` char(40) DEFAULT NULL,
  `owner_user_id` int unsigned NOT NULL,
  `schema` text,
  `text` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uid` (`uid`),
  KEY `parent_uid` (`parent_uid`),
  KEY `owner_user_id` (`owner_user_id`),
  KEY `idx_thread_uid` (`uid`),
  CONSTRAINT `thread_ibfk_1` FOREIGN KEY (`parent_uid`) REFERENCES `thread` (`uid`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `thread_ibfk_2` FOREIGN KEY (`owner_user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1987 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('thread', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('thread', 'uid', '`uid` char(40) NOT NULL');
CALL _puter_add_col('thread', 'parent_uid', '`parent_uid` char(40) DEFAULT NULL');
CALL _puter_add_col('thread', 'owner_user_id', '`owner_user_id` int unsigned NOT NULL');
CALL _puter_add_col('thread', 'schema', '`schema` text');
CALL _puter_add_col('thread', 'text', '`text` text NOT NULL');
CALL _puter_add_col('thread', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `user`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  `username` varchar(50) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `email` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `password` varchar(225) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `free_storage` bigint unsigned DEFAULT NULL,
  `max_subdomains` int unsigned DEFAULT NULL,
  `taskbar_items` text,
  `desktop_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `appdata_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `documents_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `pictures_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `videos_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `trash_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `trash_id` int unsigned DEFAULT NULL,
  `appdata_id` int unsigned DEFAULT NULL,
  `desktop_id` int unsigned DEFAULT NULL,
  `documents_id` int unsigned DEFAULT NULL,
  `pictures_id` int unsigned DEFAULT NULL,
  `videos_id` int unsigned DEFAULT NULL,
  `referrer` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `desktop_bg_url` text,
  `desktop_bg_color` varchar(20) DEFAULT NULL,
  `desktop_bg_fit` varchar(16) DEFAULT NULL,
  `pass_recovery_token` char(36) DEFAULT NULL,
  `requires_email_confirmation` tinyint(1) NOT NULL DEFAULT '0',
  `email_confirm_code` varchar(8) DEFAULT NULL,
  `email_confirm_token` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `email_confirmed` tinyint(1) NOT NULL DEFAULT '0',
  `dev_first_name` varchar(100) DEFAULT NULL,
  `dev_last_name` varchar(100) DEFAULT NULL,
  `dev_paypal` varchar(100) DEFAULT NULL,
  `dev_approved_for_incentive_program` tinyint(1) DEFAULT '0',
  `dev_joined_incentive_program` tinyint(1) DEFAULT '0',
  `suspended` tinyint(1) DEFAULT NULL,
  `unsubscribed` tinyint NOT NULL DEFAULT '0',
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_activity_ts` timestamp NULL DEFAULT NULL,
  `referral_code` varchar(16) DEFAULT NULL,
  `referred_by` int unsigned DEFAULT NULL,
  `unconfirmed_change_email` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `change_email_confirm_token` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `otp_secret` text,
  `otp_enabled` tinyint(1) DEFAULT '0',
  `otp_recovery_codes` text,
  `stripe_customer_id` varchar(40) DEFAULT NULL,
  `public_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `public_id` int DEFAULT NULL,
  `clean_email` varchar(256) DEFAULT NULL,
  `audit_metadata` json DEFAULT NULL,
  `signup_ip` varchar(45) DEFAULT NULL COMMENT 'Supports IPv6 addresses',
  `signup_ip_forwarded` varchar(45) DEFAULT NULL COMMENT 'Supports IPv6 addresses',
  `signup_user_agent` varchar(512) DEFAULT NULL,
  `signup_origin` varchar(255) DEFAULT NULL,
  `signup_server` varchar(255) DEFAULT NULL,
  `metadata` json DEFAULT (json_object()),
  `reputation` smallint DEFAULT '100',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uid` (`uuid`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `referral_code` (`referral_code`),
  KEY `email` (`email`),
  KEY `pass_recovery_token` (`pass_recovery_token`),
  KEY `referrer` (`referrer`),
  KEY `email_confirm_token` (`email_confirm_token`),
  KEY `last_activity_ts` (`last_activity_ts`),
  KEY `desktop_uuid` (`desktop_uuid`),
  KEY `appdata_uuid` (`appdata_uuid`),
  KEY `documents_uuid` (`documents_uuid`),
  KEY `pictures_uuid` (`pictures_uuid`),
  KEY `videos_uuid` (`videos_uuid`),
  KEY `trash_uuid` (`trash_uuid`),
  KEY `trash_id` (`trash_id`),
  KEY `appdata_id` (`appdata_id`),
  KEY `desktop_id` (`desktop_id`),
  KEY `documents_id` (`documents_id`),
  KEY `pictures_id` (`pictures_id`),
  KEY `videos_id` (`videos_id`),
  KEY `idx_user_referral_code` (`referral_code`),
  KEY `idx_user_referred_by` (`referred_by`),
  KEY `referrer_2` (`referrer`),
  KEY `idx_user_stripe_customer_id` (`stripe_customer_id`),
  KEY `idx_user_clean_email` (`clean_email`),
  KEY `idx_user_signup_ip` (`signup_ip`),
  KEY `idx_user_signup_ip_forwarded` (`signup_ip_forwarded`),
  KEY `idx_user_signup_user_agent` (`signup_user_agent`),
  KEY `idx_user_signup_origin` (`signup_origin`),
  KEY `idx_user_signup_server` (`signup_server`),
  CONSTRAINT `fk_user_referred_by` FOREIGN KEY (`referred_by`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2987224 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('user', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('user', 'uuid', '`uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL');
CALL _puter_add_col('user', 'username', '`username` varchar(50) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL');
CALL _puter_add_col('user', 'email', '`email` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'password', '`password` varchar(225) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'free_storage', '`free_storage` bigint unsigned DEFAULT NULL');
CALL _puter_add_col('user', 'max_subdomains', '`max_subdomains` int unsigned DEFAULT NULL');
CALL _puter_add_col('user', 'taskbar_items', '`taskbar_items` text');
CALL _puter_add_col('user', 'desktop_uuid', '`desktop_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'appdata_uuid', '`appdata_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'documents_uuid', '`documents_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'pictures_uuid', '`pictures_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'videos_uuid', '`videos_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'trash_uuid', '`trash_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'trash_id', '`trash_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('user', 'appdata_id', '`appdata_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('user', 'desktop_id', '`desktop_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('user', 'documents_id', '`documents_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('user', 'pictures_id', '`pictures_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('user', 'videos_id', '`videos_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('user', 'referrer', '`referrer` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL');
CALL _puter_add_col('user', 'desktop_bg_url', '`desktop_bg_url` text');
CALL _puter_add_col('user', 'desktop_bg_color', '`desktop_bg_color` varchar(20) DEFAULT NULL');
CALL _puter_add_col('user', 'desktop_bg_fit', '`desktop_bg_fit` varchar(16) DEFAULT NULL');
CALL _puter_add_col('user', 'pass_recovery_token', '`pass_recovery_token` char(36) DEFAULT NULL');
CALL _puter_add_col('user', 'requires_email_confirmation', '`requires_email_confirmation` tinyint(1) NOT NULL DEFAULT ''0''');
CALL _puter_add_col('user', 'email_confirm_code', '`email_confirm_code` varchar(8) DEFAULT NULL');
CALL _puter_add_col('user', 'email_confirm_token', '`email_confirm_token` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'email_confirmed', '`email_confirmed` tinyint(1) NOT NULL DEFAULT ''0''');
CALL _puter_add_col('user', 'dev_first_name', '`dev_first_name` varchar(100) DEFAULT NULL');
CALL _puter_add_col('user', 'dev_last_name', '`dev_last_name` varchar(100) DEFAULT NULL');
CALL _puter_add_col('user', 'dev_paypal', '`dev_paypal` varchar(100) DEFAULT NULL');
CALL _puter_add_col('user', 'dev_approved_for_incentive_program', '`dev_approved_for_incentive_program` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('user', 'dev_joined_incentive_program', '`dev_joined_incentive_program` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('user', 'suspended', '`suspended` tinyint(1) DEFAULT NULL');
CALL _puter_add_col('user', 'unsubscribed', '`unsubscribed` tinyint NOT NULL DEFAULT ''0''');
CALL _puter_add_col('user', 'timestamp', '`timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL _puter_add_col('user', 'last_activity_ts', '`last_activity_ts` timestamp NULL DEFAULT NULL');
CALL _puter_add_col('user', 'referral_code', '`referral_code` varchar(16) DEFAULT NULL');
CALL _puter_add_col('user', 'referred_by', '`referred_by` int unsigned DEFAULT NULL');
CALL _puter_add_col('user', 'unconfirmed_change_email', '`unconfirmed_change_email` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'change_email_confirm_token', '`change_email_confirm_token` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'otp_secret', '`otp_secret` text');
CALL _puter_add_col('user', 'otp_enabled', '`otp_enabled` tinyint(1) DEFAULT ''0''');
CALL _puter_add_col('user', 'otp_recovery_codes', '`otp_recovery_codes` text');
CALL _puter_add_col('user', 'stripe_customer_id', '`stripe_customer_id` varchar(40) DEFAULT NULL');
CALL _puter_add_col('user', 'public_uuid', '`public_uuid` char(36) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user', 'public_id', '`public_id` int DEFAULT NULL');
CALL _puter_add_col('user', 'clean_email', '`clean_email` varchar(256) DEFAULT NULL');
CALL _puter_add_col('user', 'audit_metadata', '`audit_metadata` json DEFAULT NULL');
CALL _puter_add_col('user', 'signup_ip', '`signup_ip` varchar(45) DEFAULT NULL COMMENT ''Supports IPv6 addresses''');
CALL _puter_add_col('user', 'signup_ip_forwarded', '`signup_ip_forwarded` varchar(45) DEFAULT NULL COMMENT ''Supports IPv6 addresses''');
CALL _puter_add_col('user', 'signup_user_agent', '`signup_user_agent` varchar(512) DEFAULT NULL');
CALL _puter_add_col('user', 'signup_origin', '`signup_origin` varchar(255) DEFAULT NULL');
CALL _puter_add_col('user', 'signup_server', '`signup_server` varchar(255) DEFAULT NULL');
CALL _puter_add_col('user', 'metadata', '`metadata` json DEFAULT (json_object())');
CALL _puter_add_col('user', 'reputation', '`reputation` smallint DEFAULT ''100''');

--
-- Table structure for table `user_comments`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_comments` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `uid` char(40) NOT NULL,
  `user_id` int unsigned NOT NULL,
  `metadata` json DEFAULT NULL,
  `text` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uid` (`uid`),
  KEY `user_id` (`user_id`),
  KEY `idx_user_comments_uid` (`uid`),
  CONSTRAINT `user_comments_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('user_comments', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('user_comments', 'uid', '`uid` char(40) NOT NULL');
CALL _puter_add_col('user_comments', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('user_comments', 'metadata', '`metadata` json DEFAULT NULL');
CALL _puter_add_col('user_comments', 'text', '`text` text NOT NULL');
CALL _puter_add_col('user_comments', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `user_fsentry_comments`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_fsentry_comments` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_comment_id` int unsigned NOT NULL,
  `fsentry_id` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  KEY `user_comment_id` (`user_comment_id`),
  KEY `fsentry_id` (`fsentry_id`),
  CONSTRAINT `user_fsentry_comments_ibfk_1` FOREIGN KEY (`user_comment_id`) REFERENCES `user_comments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_fsentry_comments_ibfk_2` FOREIGN KEY (`fsentry_id`) REFERENCES `fsentries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('user_fsentry_comments', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('user_fsentry_comments', 'user_comment_id', '`user_comment_id` int unsigned NOT NULL');
CALL _puter_add_col('user_fsentry_comments', 'fsentry_id', '`fsentry_id` int unsigned NOT NULL');

--
-- Table structure for table `user_oidc_providers`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_oidc_providers` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `provider` varchar(64) NOT NULL,
  `provider_sub` varchar(255) NOT NULL,
  `refresh_token` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `idx_user_oidc_providers_provider` (`provider`),
  CONSTRAINT `user_oidc_providers_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=51584 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('user_oidc_providers', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('user_oidc_providers', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('user_oidc_providers', 'provider', '`provider` varchar(64) NOT NULL');
CALL _puter_add_col('user_oidc_providers', 'provider_sub', '`provider_sub` varchar(255) NOT NULL');
CALL _puter_add_col('user_oidc_providers', 'refresh_token', '`refresh_token` text');
CALL _puter_add_col('user_oidc_providers', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `user_to_app_permissions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_to_app_permissions` (
  `user_id` int unsigned NOT NULL,
  `app_id` int unsigned NOT NULL,
  `permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `extra` json DEFAULT NULL,
  `dt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`app_id`,`permission`),
  KEY `idx_utap_user_permission` (`user_id`,`permission`),
  KEY `idx_utap_app_permission` (`app_id`,`permission`),
  CONSTRAINT `fk_user_to_app_permissions_app_id` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_user_to_app_permissions_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('user_to_app_permissions', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('user_to_app_permissions', 'app_id', '`app_id` int unsigned NOT NULL');
CALL _puter_add_col('user_to_app_permissions', 'permission', '`permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('user_to_app_permissions', 'extra', '`extra` json DEFAULT NULL');
CALL _puter_add_col('user_to_app_permissions', 'dt', '`dt` datetime DEFAULT CURRENT_TIMESTAMP');

--
-- Table structure for table `user_to_group_permissions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_to_group_permissions` (
  `user_id` int unsigned NOT NULL,
  `group_id` int unsigned NOT NULL,
  `permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `extra` json DEFAULT NULL,
  PRIMARY KEY (`user_id`,`group_id`,`permission`),
  KEY `group_id` (`group_id`),
  CONSTRAINT `user_to_group_permissions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_to_group_permissions_ibfk_2` FOREIGN KEY (`group_id`) REFERENCES `group` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('user_to_group_permissions', 'user_id', '`user_id` int unsigned NOT NULL');
CALL _puter_add_col('user_to_group_permissions', 'group_id', '`group_id` int unsigned NOT NULL');
CALL _puter_add_col('user_to_group_permissions', 'permission', '`permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('user_to_group_permissions', 'extra', '`extra` json DEFAULT NULL');

--
-- Table structure for table `user_to_user_permissions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_to_user_permissions` (
  `issuer_user_id` int unsigned NOT NULL,
  `holder_user_id` int unsigned NOT NULL,
  `permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `extra` json DEFAULT NULL,
  PRIMARY KEY (`issuer_user_id`,`holder_user_id`,`permission`),
  KEY `fk_user_to_user_permissions_holder_user_id` (`holder_user_id`),
  CONSTRAINT `fk_user_to_user_permissions_holder_user_id` FOREIGN KEY (`holder_user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_user_to_user_permissions_issuer_user_id` FOREIGN KEY (`issuer_user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('user_to_user_permissions', 'issuer_user_id', '`issuer_user_id` int unsigned NOT NULL');
CALL _puter_add_col('user_to_user_permissions', 'holder_user_id', '`holder_user_id` int unsigned NOT NULL');
CALL _puter_add_col('user_to_user_permissions', 'permission', '`permission` varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
CALL _puter_add_col('user_to_user_permissions', 'extra', '`extra` json DEFAULT NULL');

--
-- Table structure for table `user_update_audit`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_update_audit` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned DEFAULT NULL,
  `user_id_keep` int unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `old_email` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `new_email` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `old_username` varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `new_username` varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_user_update_audit_user_id` (`user_id`),
  CONSTRAINT `fk_user_update_audit_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8078 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CALL _puter_add_col('user_update_audit', 'id', '`id` int unsigned NOT NULL AUTO_INCREMENT');
CALL _puter_add_col('user_update_audit', 'user_id', '`user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('user_update_audit', 'user_id_keep', '`user_id_keep` int unsigned NOT NULL');
CALL _puter_add_col('user_update_audit', 'created_at', '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL _puter_add_col('user_update_audit', 'old_email', '`old_email` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user_update_audit', 'new_email', '`new_email` varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user_update_audit', 'old_username', '`old_username` varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user_update_audit', 'new_username', '`new_username` varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL');
CALL _puter_add_col('user_update_audit', 'reason', '`reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');


DROP PROCEDURE IF EXISTS _puter_add_col;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-02  0:09:09
