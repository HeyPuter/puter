// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const pdjs = require('@pagerduty/pdjs');
const BaseService = require('../../services/BaseService');
const util = require('util');


/**
* @class PagerService
* @extends BaseService
* @description The PagerService class is responsible for handling pager alerts.
* It extends the BaseService class and provides methods for constructing,
* initializing, and managing alert handlers. The class interacts with PagerDuty
* through the pdjs library to send alerts and integrates with other services via
* command registration.
*/
class PagerService extends BaseService {
    static USE = {
        Context: 'core.context',
    }
    
    async _construct () {
        this.config = this.global_config.pager;
        this.alertHandlers_ = [];

    }
    
    /**
     * PagerService registers its commands at the consolidation phase because
     * the '_init' method of CommandService may not have been called yet.
     */
    ['__on_boot.consolidation'] () {
        this._register_commands(this.services.get('commands'));
    }

    /**
    * Initializes the PagerService instance by setting the configuration and
    * initializing an empty alert handler array.
    *
    * @async
    * @memberOf PagerService
    * @returns {Promise<void>}
    */
    async _init () {
        this.alertHandlers_ = [];

        if ( ! this.config ) {
            return;
        }

        this.onInit();
    }

    /**
    * Initializes PagerDuty configuration and registers alert handlers.
    * If PagerDuty is enabled in the configuration, it sets up an alert handler
    * to send alerts to PagerDuty.
    *
    * @method onInit
    */
    onInit () {
        if ( this.config.pagerduty && this.config.pagerduty.enabled ) {
            this.alertHandlers_.push(async alert => {
                const event = pdjs.event;

                const fields_clean = {};
                for ( const [key, value] of Object.entries(alert?.fields ?? {}) ) {
                    fields_clean[key] = util.inspect(value);
                }

                const custom_details = {
                    ...(alert.custom || {}),
                    server_id: this.global_config.server_id,
                };

                const ctx = this.Context.get(undefined, { allow_fallback: true });

                // Add request payload if any exists
                const req = ctx.get('req');
                if ( req ) {
                    if ( req.body ) {
                        // Remove fields which may contain sensitive information
                        delete req.body.password;
                        delete req.body.email;

                        // Add the request body to the custom details
                        custom_details.request_body = req.body;
                    }
                }

                this.log.info('it is sending to PD');
                await event({
                    data: {
                        routing_key: this.config.pagerduty.routing_key,
                        event_action: 'trigger',
                        dedup_key: alert.id,
                        payload: {
                            summary: alert.message,
                            source: alert.source,
                            severity: alert.severity,
                            custom_details,
                        },
                    },
                });
            });
        }
    }


    /**
    * Sends an alert to all registered alert handlers.
    *
    * This method iterates through all alert handlers and attempts to send the alert.
    * If any handler fails to send the alert, an error message is logged.
    *
    * @param {Object} alert - The alert object containing details about the alert.
    */
    async alert (alert) {
        for ( const handler of this.alertHandlers_ ) {
            try {
                await handler(alert);
            } catch (e) {
                this.log.error(`failed to send pager alert: ${e?.message}`);
            }
        }
    }

    _register_commands (commands) {
        commands.registerCommands('pager', [
            {
                id: 'test-alert',
                description: 'create a test alert',
                handler: async (args, log) => {
                    const [severity] = args;
                    await this.alert({
                        id: 'test-alert',
                        message: 'test alert',
                        source: 'test',
                        severity,
                    });
                }
            }
        ])
    }

}

module.exports = {
    PagerService,
};
