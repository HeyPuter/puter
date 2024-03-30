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


class InformationObtainer {
    constructor (informationService, input) {
        this.informationService = informationService;
        this.input = input;
    }

    obtain (output) {
        this.output = output;
        return this;
    }

    async exec (...args) {
        const services = this.informationService.services;
        const traces = services.get('traceService');
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
class InformationService {
    constructor ({ services }) {
        this.providers_ = {};
        this.services = services;

        this.log = services.get('log-service').create('information-service');

        (async () => {
            await services.ready;
            if ( services.has('commands') ) {
                this._register_commands(services.get('commands'));
            }
        })();
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