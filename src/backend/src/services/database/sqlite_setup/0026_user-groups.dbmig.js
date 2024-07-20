const { insertId: temp_group_id } = await write(
    'INSERT INTO `group` (`uid`, `owner_user_id`, `extra`, `metadata`) '+
    'VALUES (?, ?, ?, ?)',
    [
        'b7220104-7905-4985-b996-649fdcdb3c8f',
        1,
        '{"critical": true, "type": "default", "name": "temp"}',
        '{"title": "Guest", "color": "#777777"}'
    ]
);
const [{id: system_user_id}] = await read(
    "SELECT id FROM `user` WHERE username='system'"
);
const [{id: user_group_id}] = await read(
    'SELECT id FROM `group` WHERE uid=?',
    ['78b1b1dd-c959-44d2-b02c-8735671f9997']
);

const user_types = structutil.apply_keys(
    ['name', 'group_id'],
    ['temp', temp_group_id],
    ['user', user_group_id],
);
const drivers = structutil.apply_keys(
    ['driver_id', 'selector'],
    ['driver:puter-kvstore', 'kv'],
    ['driver:puter-notifications', 'es'],
    ['driver:puter-apps', 'es'],
    ['driver:puter-subdomains', 'es'],
);

const perms = structutil.cart_product(
    [user_types, drivers]);

for ( const perm of perms ) {
    const [user_type, driver] = perm;
    log.info('permission info', { user_type, driver });
    debugger;
    // temp user drivers
    await write(
        'INSERT INTO `user_to_group_permissions` ' +
        '(`user_id`, `group_id`, `permission`, `extra`) ' +
        'VALUES (?, ?, ?, ?)',
        [
            system_user_id, user_type.group_id,
            driver.driver_id,
            JSON.stringify({
                policy: {
                    $: 'json-address',
                    path: '/admin/.policy/drivers.json',
                    selector: user_type.name + '.' +
                        driver.selector,
                }
            }),
        ]
    );
}

/*
// temp user drivers
await write(
    'INSERT INTO `user_to_group_permissions` ' +
    '(`user_id`, `group_id`, `permission`, `extra`) ' +
    'VALUES (?, ?, ?, ?)',
    [
        system_user_id, temp_group_id,
        'driver:puter-kvstore',
        JSON.stringify({
            policy: {
                $: 'json-address',
                path: '/admin/.policy/drivers.json',
                selector: 'temp.kv',
            }
        }),
    ]
);

// registered user drivers
await write(
    'INSERT INTO `user_to_group_permissions` ' +
    '(`user_id`, `group_id`, `permission`, `extra`) ' +
    'VALUES (?, ?, ?, ?)',
    [
        system_user_id, user_group_id,
        'driver:puter-kvstore',
        JSON.stringify({
            policy: {
                $: 'json-address',
                path: '/admin/.policy/drivers.json',
                selector: 'user.kv',
            }
        }),
    ]
);
*/
