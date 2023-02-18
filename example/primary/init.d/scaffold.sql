CREATE DATABASE IF NOT EXISTS `linkdarkly`;
use `linkdarkly`;

DROP TABLE IF EXISTS `links`;
CREATE TABLE `links` (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
     url TEXT NOT NULL,
     deleted BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (id)
);

-- increase performance and save some disk space
SET sql_log_bin = 0;
SET GLOBAL innodb_flush_log_at_trx_commit = 0;

LOAD DATA INFILE '/var/lib/mysql-files/links.csv' INTO TABLE `links`
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
  LINES TERMINATED BY '\n' (id, url);

SET GLOBAL innodb_flush_log_at_trx_commit = 1;
SET sql_log_bin = 1;