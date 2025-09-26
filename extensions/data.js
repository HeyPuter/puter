//@extension priority -10000

const { DB_WRITE } = extension.import('core').database;
const svc_database = extension.import('service:database');
const svc_kvstore = extension.import('service:puter-kvstore');

extension.exports = {
    db: svc_database.get(DB_WRITE, 'extensions'),
    kv: svc_kvstore.as('puter-kvstore'),
};
