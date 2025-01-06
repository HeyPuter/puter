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

// METADATA // {"def":"core.expect"}
const { v4: uuidv4 } = require('uuid');

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
            `expected ${JSON.stringify(this.checkpoint)} ` +
            `and got ${JSON.stringify(this.workUnit.checkpoint_)}.`
        );
    }
}

module.exports = {
    WorkUnit,
    CheckpointExpectation,
};
