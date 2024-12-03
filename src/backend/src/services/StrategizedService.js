// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { TechnicalError } = require("../errors/TechnicalError");
const { quot } = require("../util/strutil");


/**
* Represents a service that applies strategies based on provided configuration 
* and specified keys. The StrategizedService class initializes and manages 
* strategies for a given service, ensuring that the necessary configurations 
* and arguments are provided before attempting to execute any strategy logic.
*/
class StrategizedService {
    constructor (service_resources, ...a) {
        const { my_config, args, name } = service_resources;

        const key = args.strategy_key;
        if ( ! args.default_strategy && ! my_config.hasOwnProperty(key) ) {
            this.initError = new TechnicalError(
                `Must specify ${quot(key)} for service ${quot(name)}.`
            );
            return;
        }

        if ( ! args.hasOwnProperty('strategies') ) {
            throw new Error('strategies not defined in service args')
        }

        const strategy_key = my_config[key] ?? args.default_strategy;
        if ( ! args.strategies.hasOwnProperty(strategy_key) ) {
            this.initError = new TechnicalError(
                `Invalid ${key} ${quot(strategy_key)} for service ${quot(name)}.`
            );
            return;
        }
        const [cls, cls_args] = args.strategies[strategy_key];

        const cls_resources = {
            ...service_resources,
            args: cls_args,
        };
        this.strategy = new cls(cls_resources, ...a);

        return this.strategy;
    }


    /**
     * Initializes the service and throws an error if initialization fails.
     * This method utilizes the initError property to determine if an error
     * occurred during the setup process in the constructor.
     * 
     * @throws {TechnicalError} Throws a TechnicalError if initError is set.
     */
    async init () {
        throw this.initError;
    }


    /**
     * Constructs a new instance of the service.
     * 
     * This method initializes any necessary resources or settings for the service instance.
     * It does not accept any parameters and does not return any value.
     */
    async construct () {}
}

module.exports = {
    StrategizedService,
};
