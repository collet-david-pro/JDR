-- Executed once, when the db volume is created.
-- Development base `jdr_dev` is created by MYSQL_DATABASE; this adds the test base.
CREATE DATABASE IF NOT EXISTS `jdr_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON `jdr_test`.* TO 'jdr'@'%';
FLUSH PRIVILEGES;
