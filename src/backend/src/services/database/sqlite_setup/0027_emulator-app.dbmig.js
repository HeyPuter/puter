// METADATA // {"ai-commented":{"service":"xai"}}
const insert = async (tbl, subject) => {
    const keys = Object.keys(subject);

    await write(
        'INSERT INTO `'+ tbl +'` ' +
        '(' + keys.map(key => key).join(', ') + ') ' +
        'VALUES (' + keys.map(() => '?').join(', ') + ')',
        keys.map(key => subject[key])
    );
}

await insert('apps', {
    uid: 'app-fbbdb72b-ad08-4cb4-86a1-de0f27cf2e1e',
    owner_user_id: 1,
    name: 'puter-linux',
    index_url: 'https://builtins.namespaces.puter.com/emulator',
    title: 'Puter Linux',
    description: 'Linux emulator for Puter',
    approved_for_listing: 1,
    approved_for_opening_items: 1,
    approved_for_incentive_program: 0,
    timestamp: '2020-01-01 00:00:00',
});
