const { whatis } = require("../util/langutil");
const { Actor, UserActorType } = require("./auth/Actor");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

class ShareService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
        validator: require('validator'),
    };

    async _init () {
        this.db = await this.services.get('database').get(DB_WRITE, 'share');
    }
    
    async create_share ({
        issuer,
        email,
        data,
    }) {
        const require = this.require;
        const validator = require('validator');
        
        // track: type check
        if ( typeof email !== 'string' ) {
            throw new Error('email must be a string');
        }
        // track: type check
        if ( whatis(data) !== 'object' ) {
            throw new Error('data must be an object');
        }

        // track: adapt
        issuer = Actor.adapt(issuer);
        // track: type check
        if ( ! (issuer instanceof Actor) ) {
            throw new Error('expected issuer to be Actor');
        }
        
        // track: actor type
        if ( ! (issuer.type instanceof UserActorType) ) {
            throw new Error('only users are allowed to create shares');
        }
        
        if ( ! validator.isEmail(email) ) {
            throw new Error('invalid email');
        }
        
        const uuid = this.modules.uuidv4();
        
        await this.db.write(
            'INSERT INTO `share` ' +
            '(`uid`, `issuer_user_id`, `recipient_email`, `data`) ' +
            'VALUES (?, ?, ?, ?)',
            [uuid, issuer.type.user.id, email, JSON.stringify(data)]
        );
        
        return uuid;
    }
}

module.exports = {
    ShareService,
};

