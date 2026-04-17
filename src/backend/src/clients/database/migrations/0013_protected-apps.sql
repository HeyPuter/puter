ALTER TABLE apps ADD COLUMN "protected" tinyint(1) DEFAULT '0';
ALTER TABLE subdomains ADD COLUMN "protected" tinyint(1) DEFAULT '0';
