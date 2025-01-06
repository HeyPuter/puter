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

const { expect } = require('chai');
const { AdvancedBase } = require("../src/AdvancedBase");
const { TTopics, TDetachable } = require("../src/traits/traits");

describe('topics', () => {
    it ('works', () => {
        // A trait for something that's "punchable"
        const TPunchable = Symbol('punchable');

        class SomeClassWithTopics extends AdvancedBase {
            // We can "listen on punched"
            static TOPICS = ['punched']

            // Punchable trait implementation
            static IMPLEMENTS = {
                [TPunchable]: {
                    punch () {
                        this.as(TTopics).pub('punched', {
                            information: 'about the punch',
                            in_whatever: 'format you desire',
                        });
                    }
                }
            }
        }

        const thingy = new SomeClassWithTopics();
        
        // Register the first listener, which we expect to be called both times
        let first_listener_called = false;
        thingy.as(TTopics).sub('punched', () => {
            first_listener_called = true;
        });

        // Register the second listener, which we expect to be called once,
        // and then we're gonna detach it and make sure detach works
        let second_listener_call_count = 0;
        const det = thingy.as(TTopics).sub('punched', () => {
            second_listener_call_count++;
        });

        thingy.as(TPunchable).punch();
        det.as(TDetachable).detach();
        thingy.as(TPunchable).punch();

        expect(first_listener_called).to.equal(true);
        expect(second_listener_call_count).to.equal(1);
    })
});
