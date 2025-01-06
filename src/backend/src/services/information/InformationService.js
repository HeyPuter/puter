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

const BaseService = require("../BaseService");

/**
* @class InformationProvider
* @classdesc The InformationProvider class facilitates the registration of strategies for providing information based on given inputs. It allows services to register methods for obtaining information and optimizes the process by determining the most efficient methods for retrieving the required information.
*/
class InformationProvider {
    constructor (informationService, input) {
        this.informationService = informationService;
        this.input = input;
    }

    provide (output) {
        this.output = output;
        return this;
    }

    addStrategy (id, provider) {
        this.informationService.register_provider_(
            this.output, this.input, { id, fn: provider });
        return this;
    }
}



/**
* Class InformationObtainer
*
* This class is responsible for obtaining information from various services. It takes an
* InformationService instance and an input, allowing it to obtain specific outputs based on
* the input provided. The class provides methods to specify the desired output and execute
* the information retrieval process.
*/
class InformationObtainer {
    constructor (informationService, input) {
        this.informationService = informationService;
        this.input = input;
    }

    obtain (output) {
        this.output = output;
        return this;
    }


    /**
    * Executes the information obtaining process asynchronously.
    *
    * This method wraps the process of obtaining information in a trace span for monitoring purposes.
    * It retrieves the necessary services and traces, then delegates the actual obtaining process
    * to the `obtain_` method of the `InformationService`.
    *
    * @async
    * @function exec
    * @param {...*} args - Variable number of arguments to be passed to the obtaining process.
    * @returns {Promise<*>} - A promise that resolves to the obtained information.
    */
    async exec (...args) {
        const services = this.informationService.services;
        const traces = services.get('traceService');
        /**
        * Executes the obtaining process for the specified output from the specified input.
        * This method retrieves the relevant information service, traces, and spans the execution to
        * obtain the information asynchronously. It uses the informationService.obtain_ method to perform the actual retrieval.
        *
        * @async
        * @method exec
        * @param {...*} args - The arguments required for the obtaining process.
        * @returns {Promise<*>} - A promise that resolves to the obtained information.
        */
        return await traces.spanify(`OBTAIN ${this.output} FROM ${this.input}`, async () => {
            return (await this.informationService.obtain_(
                this.output, this.input, ...args)).result;
        });
    }
}

/**
 * Allows services to provide methods for obtaining information,
 * and other services to obtain that information. Also optimizes
 * obtaining information by determining which methods are the
 * most efficient for obtaining the information.
 * 
 * @example Obtain an fsentry given a path:
 * 
 *    const infosvc = services.get('information');
 *    const fsentry = await infosvc
 *      .with('fs.fsentry:path').obtain('fs.fsentry')
 *      .exec(path);
 * 
 * @example Register a method for obtaining an fsentry given a path:
 * 
 *    const infosvc = services.get('information');
 *    infosvc.given('fs.fsentry:path').provide('fs.fsentry')
 *      .addStrategy(async path => {
 *         // code to obtain fsentry from path
 *     });
 */
class InformationService extends BaseService {
    /**
    * @class
    * @extends BaseService
    * @description Provides a service for managing information providers and obtaining information efficiently.
    * @notes This class extends BaseService and includes methods for registering providers, obtaining information,
    * and managing command registrations.
    */
    _construct () {
        this.providers_ = {};
    }


    /**
    * Initializes the service by registering commands.
    *
    * @private
    * @method _init
    * @returns {void}
    */
    _init () {
        this._register_commands(this.services.get('commands'));
    }

    given (input) {
        return new InformationProvider(this, input);
    }

    with (input) {
        return new InformationObtainer(this, input);
    }

    register_provider_ (output, input, provider) {
        this.providers_ = this.providers_ || {};
        this.providers_[output] = this.providers_[output] || {};
        this.providers_[output][input] = this.providers_[output][input] || [];
        this.providers_[output][input].push(provider);
    }


    /**
    * Asynchronously obtains information based on the provided output and input parameters.
    * This method iterates through registered providers, sorts them for optimization,
    * and attempts to fetch the desired information.
    *
    * @async
    * @function obtain_
    * @param {string} output - The type of information to obtain.
    * @param {string} input - The input parameter required to obtain the information.
    * @param {...*} args - Additional arguments to pass to the provider functions.
    * @returns {Promise<Object>} An object containing the provider ID and the result.
    * @throws {Error} If no providers are available for the given output and input.
    */
    async obtain_ (output, input, ...args) {
        const providers = this.providers_[output][input];
        if ( ! providers ) {
            throw new Error(`no providers for ${output} <- ${input}`);
        }

        // shuffle providers (for future performance optimization)
        providers.sort(() => Math.random() - 0.5);

        // put providers with id 'redis' first
        providers.sort((a, b) => {
            if ( a.id === 'redis' ) return -1;
            if ( b.id === 'redis' ) return 1;
            return 0;
        });

        // for now, go with the first provider that provides something
        for ( const provider of providers ) {
            this.log.debug(`trying provider ${provider.id} for ${output} <- ${input}`);
            const result = await provider.fn(...args);
            this.log.debug(`provider ${provider.id} for ${output} <- ${input} returned ${result}`);
            // TODO: log strategy used as span attribute/tag
            if ( result !== undefined ) return { provider: provider.id, result };
        }
    }

    _register_commands (commands) {
        commands.registerCommands('info', [
            {
                id: 'providers',
                description: 'List information providers',
                handler: async (args, log) => {
                    const providers = this.providers_;
                    for ( const [output, inputs] of Object.entries(providers) ) {
                        for ( const [input, providers] of Object.entries(inputs) ) {
                            for ( const provider of providers ) {
                                log.log(`${output} <- ${input} (${provider.id})`);
                            }
                        }
                    }
                }
            },
            {
                id: 'get',
                description: 'List information providers',
                handler: async (args, log) => {
                    if ( args.length < 1 ) {
                        log.log(`usage: info:get <want> <have> <value>`);
                        return;
                    }
                    const [want, have, value] = args;
                    this.log.debug(`info:get ${want} <- ${have} (${value})`);
                    const result = await this.obtain_(want, have, value);
                    let result_str;
                    try {
                        result_str = JSON.stringify(result.result);
                    } catch (e) {
                        result_str = '' + result.result;
                    }
                    log.log(`${want} <- ${have} (${value}) = ${result_str} (via ${result.provider})`);
                }
            }
        ]);
    }
}

module.exports = {
    InformationService
};