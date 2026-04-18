-- fixing owner IDs for default apps;
-- they should all be owned by 'default_user'

UPDATE `apps` SET `maximize_on_start`=1 WHERE `uid`='app-0b37f054-07d4-4627-8765-11bd23e889d4';
