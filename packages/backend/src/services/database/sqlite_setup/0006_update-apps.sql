UPDATE `apps` SET `index_url` = 'https://builtins.namespaces.puter.com/terminal' WHERE `name` = 'terminal';

INSERT INTO `apps` (`uid`, `owner_user_id`, `name`, `title`, `description`, `godmode`, `background`, `maximize_on_start`, `index_url`, `approved_for_listing`, `approved_for_opening_items`, `approved_for_incentive_program`, `timestamp`, `last_review`, `tags`, `app_owner`) VALUES (
    '129e4bfb-4c8a-47e0-bec2-0279c21ace06', 1,
    'phoenix','Phoenix Shell','',0,1,1,'https://builtins.namespaces.puter.com/phoenix',1,0,0,'2022-08-16 01:28:47',NULL,'productivity',NULL);
