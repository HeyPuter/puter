// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const { v4: uuidv4 } = require('uuid');
const BaseService = require('../../services/BaseService');

/**
* @class ExpectationService
* @extends BaseService
*
* The `ExpectationService` is a specialized service designed to assist in the diagnosis and
* management of errors related to the intricate interactions among asynchronous operations.
* It facilitates tracking and reporting on expectations, enabling better fault isolation
* and resolution in systems where synchronization and timing of operations are crucial.
*
* This service inherits from the `BaseService` and provides methods for registering,
* purging, and handling expectations, making it a valuable tool for diagnosing complex
* runtime behaviors in a system.
*/
class ExpectationService extends BaseService {
    static USE = {
        expect: 'core.expect'
    };

    /**
    * Constructs the ExpectationService and initializes its internal state.
    * This method is intended to be called asynchronously.
    * It sets up the `expectations_` array which will be used to track expectations.
    *
    * @async
    */
    async _construct () {
        this.expectations_ = [];
    }

    /**
     * ExpectationService registers its commands at the consolidation phase because
     * the '_init' method of CommandService may not have been called yet.
     */
    ['__on_boot.consolidation'] () {
        const commands = this.services.get('commands');
        commands.registerCommands('expectations', [
            {
                id: 'pending',
                description: 'lists pending expectations',
                handler: async (args, log) => {
                    this.purgeExpectations_();
                    if ( this.expectations_.length < 1 ) {
                        log.log(`there are none`);
                        return;
                    }
                    for ( const expectation of this.expectations_ ) {
                        expectation.report(log);
                    }
                }
            }
        ]);
    }

    /**
    * Initializes the ExpectationService, setting up interval functions and registering commands.
    *
    * This method sets up a periodic interval to purge expectations and registers a command
    * to list pending expectations. The interval invokes `purgeExpectations_` every second.
    * The command 'pending' allows users to list and log all pending expectations.
    *
    * @returns {Promise<void>} A promise that resolves when initialization is complete.
    */
    async _init () {
        const services = this.services;

        // TODO: service to track all interval functions?
        /**
        * Initializes the service by setting up interval functions and registering commands.
        * This method sets up a periodic interval function to purge expectations and registers
        * a command to list pending expectations.
        *
        * @returns {void}
        */
        
        // The comment should be placed above the method at line 68
        setInterval(() => {
            this.purgeExpectations_();
        }, 1000);
    }


    /**
    * Purges expectations that have been met.
    *
    * This method iterates through the list of expectations and removes
    * those that have been satisfied. Currently, this functionality is
    * disabled and needs to be re-enabled.
    *
    * @returns {void} This method does not return anything.
    */
    purgeExpectations_ () {
        return;
        // TODO: Re-enable this
        // for ( let i=0 ; i < this.expectations_.length ; i++ ) {
        //     if ( this.expectations_[i].check() ) {
        //         this.expectations_[i] = null;
        //     }
        // }
        // this.expectations_ = this.expectations_.filter(v => v !== null);
    }

    expect_eventually ({ workUnit, checkpoint }) {
        this.expectations_.push(new this.expect.CheckpointExpectation(workUnit, checkpoint));
    }
}



module.exports = {
    ExpectationService
};