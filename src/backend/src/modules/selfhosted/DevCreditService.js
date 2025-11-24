const BaseService = require('../../services/BaseService');

/**
 * PermissiveCreditService listens to the event where DriverService asks
 * for a credit context, and always provides one that allows use of
 * cost-incurring services for no charge. This grants free use to
 * everyone to services that incur a cost, as long as the user has
 * permission to call the respective service.
 */
class PermissiveCreditService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    };
    _init () {
        // Maps usernames to simulated credit amounts
        // (used when config.simulated_credit is set)
        this.simulated_credit_ = {};

        const svc_event = this.services.get('event');
        svc_event.on('credit.check-available', (_, event) => {
            const username = event.actor.type.user.username;
            event.available = this.get_user_credit_(username);

            // Useful for testing with Dall-E
            // event.available = 4 * Math.pow(10,6);

            // Useful for testing with Polly
            // event.available = 9000;

            // Useful for testing judge0
            // event.available = 50_000;
            // event.avaialble = 49_999;

            // Useful for testing ConvertAPI
            // event.available = 4_500_000;
            // event.available = 4_499_999;

            // Useful for testing with textract
            // event.available = 150_000;
            // event.available = 149_999;
        });

        svc_event.on('credit.record-cost', (_, event) => {
            const username = event.actor.type.user.username;
            event.available = this.consume_user_credit_(username, event.cost);
            if ( ! this.config.simulated_credit ) return;

            // Update usage settings tab in UI
            svc_event.emit('outer.gui.usage.update', {
                user_id_list: [event.actor.type.user.id],
                response: {
                    id: 'dev-credit',
                    used: this.config.simulated_credit -
                        this.get_user_credit_(username),
                    available: this.config.simulated_credit,
                },
            });
        });

        svc_event.on('usages.query', (_, event) => {
            const username = event.actor.type.user.username;
            if ( ! this.config.simulated_credit ) {
                event.usages.push({
                    id: 'dev-credit',
                    name: 'Unlimited Credit',
                    used: 0,
                    available: 1,
                });
                return;
            }
            event.usages.push({
                id: 'dev-credit',
                name: `Simulated Credit (${this.config.simulated_credit})`,
                used: this.config.simulated_credit -
                    this.get_user_credit_(username),
                available: this.config.simulated_credit,
            });
        });
    }
    get_user_credit_ (username) {
        if ( ! this.config.simulated_credit ) {
            return Number.MAX_SAFE_INTEGER;
        }

        return this.simulated_credit_[username] ??
            (this.simulated_credit_[username] = this.config.simulated_credit);

    }
    consume_user_credit_ (username, amount) {
        if ( ! this.config.simulated_credit ) return;

        if ( ! this.simulated_credit_[username] ) {
            this.simulated_credit_[username] = this.config.simulated_credit;
        }
        this.simulated_credit_[username] -= amount;
    }
}

module.exports = PermissiveCreditService;
