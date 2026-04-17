-- fixing owner IDs for default apps;
-- they should all be owned by 'default_user'

UPDATE `apps` SET `owner_user_id`=1 WHERE `uid` IN
(
    'app-7870be61-8dff-4a99-af64-e9ae6811e367',
    'app-3920851d-bda8-479b-9407-8517293c7d44',
    'app-5584fbf7-ed69-41fc-99cd-85da21b1ef51',
    'app-11edfba2-1ed3-4e22-8573-47e88fb87d70',
    'app-7bdca1a4-6373-4c98-ad97-03ff2d608ca1'
);
