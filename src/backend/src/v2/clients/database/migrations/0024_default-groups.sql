INSERT INTO `group` (
    `uid`,
    `owner_user_id`,
    `extra`,
    `metadata`
) VALUES
    ('26bfb1fb-421f-45bc-9aa4-d81ea569e7a5', 1,
        '{"critical": true, "type": "default", "name": "system"}',
        '{"title": "System", "color": "#000000"}'),
    ('ca342a5e-b13d-4dee-9048-58b11a57cc55', 1,
        '{"critical": true, "type": "default", "name": "admin"}',
        '{"title": "Admin", "color": "#a83232"}'),
    ('78b1b1dd-c959-44d2-b02c-8735671f9997', 1,
        '{"critical": true, "type": "default", "name": "user"}',
        '{"title": "User", "color": "#3254a8"}'),
    ('3c2dfff7-d22a-41aa-a193-59a61dac4b64', 1,
        '{"type": "default", "name": "moderator"}',
        '{"title": "Moderator", "color": "#a432a8"}'),
    ('5e8f251d-3382-4b0d-932c-7bb82f48652f', 1,
        '{"type": "default", "name": "developer"}',
        '{"title": "Developer", "color": "#32a852"}')
    ;
