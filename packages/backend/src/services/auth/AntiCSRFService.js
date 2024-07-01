const eggspress = require("../../api/eggspress");
const config = require("../../config");
const { subdomain } = require("../../helpers");
const BaseService = require("../BaseService");

class CircularQueue {
    constructor (size) {
        this.size = size;
        this.queue = [];
        this.index = 0;
        this.map = new Map();
    }

    push (item) {
        if ( this.queue[this.index] ) {
            this.map.delete(this.queue[this.index]);
        }
        this.queue[this.index] = item;
        this.map.set(item, this.index);
        this.index = (this.index + 1) % this.size;
    }

    get (index) {
        return this.queue[(this.index + index) % this.size];
    }

    has (item) {
        return this.map.has(item);
    }

    maybe_consume (item) {
        if ( this.has(item) ) {
            const index = this.map.get(item);
            this.map.delete(item);
            this.queue[index] = null;
            return true;
        }
        return false;
    }
}

class AntiCSRFService extends BaseService {
    _construct () {
        this.map_session_to_tokens = {};
    }

    ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');

        app.use(eggspress('/get-anticsrf-token', {
            auth2: true,
            allowedMethods: ['GET'],
        }, async (req, res) => {
            // We disallow `api.` because it has a more relaxed CORS policy
            const subdomain_check = config.experimental_no_subdomain ||
                (subdomain(req) !== 'api');
            if ( ! subdomain_check ) {
                return res.status(404).send('Hey, stop that!');
            }

            // TODO: session uuid instead of user
            const token = this.create_token(req.user.uuid);
            res.send({ token });
        }));
    }

    create_token (session) {
        let tokens = this.map_session_to_tokens[session];
        if ( ! tokens ) {
            tokens = new CircularQueue(10);
            this.map_session_to_tokens[session] = tokens;
        }
        const token = this.generate_token_();
        tokens.push(token);
        return token;
    }

    consume_token (session, token) {
        const tokens = this.map_session_to_tokens[session];
        if ( ! tokens ) return false;
        return tokens.maybe_consume(token);
    }

    generate_token_ () {
        return require('crypto').randomBytes(32).toString('hex');
    }

    _test ({ assert }) {
        // Do this several times, like a user would
        for ( let i=0 ; i < 30 ; i++ ) {
            // Generate 30 tokens
            const tokens = [];
            for ( let j=0 ; j < 30 ; j++ ) {
                tokens.push(this.create_token('session'));
            }
            // Only the last 10 should be valid
            const results_for_stale_tokens = [];
            for ( let j=0 ; j < 20 ; j++ ) {
                const result = this.consume_token('session', tokens[j]);
                results_for_stale_tokens.push(result);
            }
            assert(() => results_for_stale_tokens.every(v => v === false));
            // The last 10 should be valid
            const results_for_valid_tokens = [];
            for ( let j=20 ; j < 30 ; j++ ) {
                const result = this.consume_token('session', tokens[j]);
                results_for_valid_tokens.push(result);
            }
            assert(() => results_for_valid_tokens.every(v => v === true));
            // A completely arbitrary token should not be valid
            assert(() => this.consume_token('session', 'arbitrary') === false);
        }
    }
}

module.exports = {
    AntiCSRFService,
};
