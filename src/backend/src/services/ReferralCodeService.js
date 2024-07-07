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
const seedrandom = require('seedrandom');
const { generate_random_code } = require('../util/identifier');
const { Context } = require('../util/context');
const { get_user } = require('../helpers');
const { DB_WRITE } = require('./database/consts');

class ReferralCodeService {
    constructor ({ services }) {
        this.log = services.get('log-service').create('referral-service');
        this.errors = services.get('error-service').create(this.log);

        this.REFERRAL_INCREASE_LEFT = 1 * 1024 * 1024 * 1024; // 1 GB
        this.REFERRAL_INCREASE_RIGHT = 1 * 1024 * 1024 * 1024; // 1 GB
        this.STORAGE_INCREASE_STRING = '1 GB';
    }

    async gen_referral_code (user) {
        let iteration = 0;
        let rng = seedrandom(`gen1-${user.id}`);
        let referral_code = generate_random_code(8, { rng });

        if ( ! user || (user?.id == undefined) ) {
            const err = new Error('missing user in gen_referral_code');
            this.errors.report('missing user in gen_referral_code', {
                source: err,
                trace: true,
                alarm: true,
            });
            throw err;
        }

        const TRIES = 5;

        const db = Context.get('services').get('database').get(DB_WRITE, 'referrals');

        let last_error = null;
        for ( let i=0 ; i <  TRIES; i++ ) {
            this.log.noticeme(`trying referral code ${referral_code}`)
            if ( i > 0 ) {
                rng = seedrandom(`gen1-${user.id}-${++iteration}`);
                referral_code = generate_random_code(8, { rng });
            }
            try {
                const update_res = db.write(`
                    UPDATE user SET referral_code=? WHERE id=?
                `, [referral_code, user.id]);
                return referral_code;
            } catch (e) {
                last_error = e;
            }
        }

        this.errors.report('referral-service.gen-referral-code', {
            source: last_error,
            trace: true,
            alarm: true,
        });

        throw last_error ?? new Error('unknown error from gen_referral_code');
    }

    async on_verified (user) {
        if ( ! user.referred_by ) return;

        const referred_by = await get_user({ id: user.referred_by });

        // since this event handler is only called when the user is verified,
        // we can assume that the `user` is already verified.

        // the referred_by user does not need to be verified at all

        // TODO: rename 'sizeService' to 'storage-capacity'
        const svc_size = Context.get('services').get('sizeService');
        await svc_size.add_storage(
            user,
            this.REFERRAL_INCREASE_RIGHT,
            `user ${user.id} used referral code of user ${referred_by.id}`,
            {
                field_a: referred_by.referral_code,
                field_b: 'REFER_R'
            }
        );
        await svc_size.add_storage(
            referred_by,
            this.REFERRAL_INCREASE_LEFT,
            `user ${referred_by.id} referred user ${user.id}`,
            {
                field_a: referred_by.referral_code,
                field_b: 'REFER_L'
            }
        );

        const svc_email = Context.get('services').get('email');
        await svc_email.send_email (referred_by, 'new-referral', {
            storage_increase: this.STORAGE_INCREASE_STRING
        })
    }
}

module.exports = {
    ReferralCodeService
};
