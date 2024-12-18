// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
