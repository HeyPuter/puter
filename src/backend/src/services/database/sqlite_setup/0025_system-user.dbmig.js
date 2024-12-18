// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
/*
Add a user called `system`.

If a user called `system` already exists, first rename the existing
user to the first username in this sequence:
    system_, system_0, system_1, system_2, ...
*/

let existing_user;

;[existing_user] = await read(
    "SELECT username FROM `user` WHERE username='system'",
);

if ( existing_user ) {
    let replace_num = 0;
    let replace_name = 'system_';

    for (;;) {
        ;[existing_user] = await read(
            'SELECT username FROM `user` WHERE username=?',
            [replace_name]
        );
        if ( ! existing_user ) break;
        replace_name = 'system_' + (replace_num++);
    }
    
    log.noticeme('updating existing user called system', {
        replace_num,
        replace_name,
    });

    await write(
        `UPDATE \`user\` SET username=? WHERE username='system' LIMIT 1`,
        [replace_name]
    );
}

const { insertId: system_user_id } = await write(
    'INSERT INTO `user` (`uuid`, `username`) VALUES (?, ?)',
    [
        '5d4adce0-a381-4982-9c02-6e2540026238',
        'system',
    ]
);

const [{id: system_group_id}] = await read(
    'SELECT id FROM `group` WHERE uid=?',
    ['26bfb1fb-421f-45bc-9aa4-d81ea569e7a5']
);

const [{id: admin_group_id}] = await read(
    'SELECT id FROM `group` WHERE uid=?',
    ['ca342a5e-b13d-4dee-9048-58b11a57cc55']
);

// admin group has unlimited access to all drivers
await write(
    'INSERT INTO `user_to_group_permissions` ' +
    '(`user_id`, `group_id`, `permission`, `extra`) ' +
    'VALUES (?, ?, ?, ?)',
    [system_user_id, admin_group_id, 'driver', '{}']
);
