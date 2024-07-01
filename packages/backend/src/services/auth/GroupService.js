const BaseService = require("../BaseService");
const { DB_WRITE } = require("../database/consts");

class GroupService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    };

    _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'permissions');
    }
    
    async get({ uid }) {
        const [group] =
            await this.db.read('SELECT * FROM `group` WHERE uid=?', [uid]);
        if ( ! group ) return;
        group.extra = this.db.case({
            mysql: () => group.extra,
            otherwise: () => JSON.parse(group.extra),
        })();
        group.metadata = this.db.case({
            mysql: () => group.metadata,
            otherwise: () => JSON.parse(group.metadata),
        })();
        return group;
    }
    
    async create ({ owner_user_id, extra, metadata }) {
        extra = extra ?? {};
        metadata = metadata ?? {};
        
        const uid = this.modules.uuidv4();
        
        await this.db.write(
            'INSERT INTO `group` ' +
            '(`uid`, `owner_user_id`, `extra`, `metadata`) ' +
            'VALUES (?, ?, ?, ?)',
            [
                uid, owner_user_id,
                JSON.stringify(extra),
                JSON.stringify(metadata),
            ]
        );
        
        return uid;
    }
    
    async add_users ({ uid, users }) {
        const question_marks =
            '(' + Array(users.length).fill('?').join(', ') + ')';
        await this.db.write(
            'INSERT INTO `jct_user_group` ' +
            '(user_id, group_id) ' +
            'SELECT u.id, g.id FROM user u '+
            'JOIN (SELECT id FROM `group` WHERE uid=?) g ON 1=1 ' +
            'WHERE u.username IN ' +
            question_marks,
            [uid, ...users],
        );
    }
    
    async remove_users ({ uid, users }) {
        const question_marks =
            '(' + Array(users.length).fill('?').join(', ') + ')';
        /*
DELETE FROM `jct_user_group`
WHERE group_id = 1
AND user_id IN (
    SELECT u.id
    FROM user u
    WHERE u.username IN ('user_that_shares', 'user_that_gets_shared_to')
);
        */
        await this.db.write(
            'DELETE FROM `jct_user_group` ' +
            'WHERE group_id = (SELECT id FROM `group` WHERE uid=?) ' +
            'AND user_id IN (' +
                'SELECT u.id FROM user u ' +
                'WHERE u.username IN ' +
                question_marks +
            ')',
            [uid, ...users],
        );
    }
}

module.exports = {
    GroupService,
};
