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
const { quot } = require('../../util/strutil');
const BaseService = require('../BaseService');


/**
* @class WorkUnit
* @description The WorkUnit class represents a unit of work that can be tracked and monitored for checkpoints.
* It includes methods to create instances, set checkpoints, and manage the state of the work unit.
*/
class WorkUnit {
    /**
    * Represents a unit of work with checkpointing capabilities.
    *
    * @class
    */
    
    /**
    * Creates and returns a new instance of WorkUnit.
    *
    * @static
    * @returns {WorkUnit} A new instance of WorkUnit.
    */
    static create () {
        return new WorkUnit();
    }
    /**
    * Creates a new instance of the WorkUnit class.
    * @static
    * @returns {WorkUnit} A new WorkUnit instance.
    */
    constructor () {
        this.id = uuidv4();
        this.checkpoint_ = null;
    }
    checkpoint (label) {
        console.log('CHECKPOINT', label);
        this.checkpoint_ = label;
    }
}


/**
* @class CheckpointExpectation
* @classdesc The CheckpointExpectation class is used to represent an expectation that a specific checkpoint
* will be reached during the execution of a work unit. It includes methods to check if the checkpoint has
* been reached and to report the results of this check.
*/
class CheckpointExpectation {
    constructor (workUnit, checkpoint) {
        this.workUnit = workUnit;
        this.checkpoint = checkpoint;
    }
    /**
    * Constructor for CheckpointExpectation class.
    * Initializes the instance with a WorkUnit and a checkpoint label.
    * @param {WorkUnit} workUnit - The work unit associated with the checkpoint.
    * @param {string} checkpoint - The checkpoint label to be checked.
    */
    check () {
        // TODO: should be true if checkpoint was ever reached
        return this.workUnit.checkpoint_ == this.checkpoint;
    }
    report (log) {
        if ( this.check() ) return;
        log.log(
            `operation(${this.workUnit.id}): ` +
            `expected ${quot(this.checkpoint)} ` +
            `and got ${quot(this.workUnit.checkpoint_)}.`
        );
    }
}

/**
 * This service helps diagnose errors involving the potentially
 * complex relationships between asynchronous operations.
 */
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

        const commands = services.get('commands');
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
        this.expectations_.push(new CheckpointExpectation(workUnit, checkpoint));
    }
}



module.exports = {
    WorkUnit,
    ExpectationService
};