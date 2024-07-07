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

class WorkUnit {
    static create () {
        return new WorkUnit();
    }
    constructor () {
        this.id = uuidv4();
        this.checkpoint_ = null;
    }
    checkpoint (label) {
        console.log('CHECKPOINT', label);
        this.checkpoint_ = label;
    }
}

class CheckpointExpectation {
    constructor (workUnit, checkpoint) {
        this.workUnit = workUnit;
        this.checkpoint = checkpoint;
    }
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
class ExpectationService extends BaseService {
    async _construct () {
        this.expectations_ = [];
    }

    async _init () {
        const services = this.services;

        // TODO: service to track all interval functions?
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