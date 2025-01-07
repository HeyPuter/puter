// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
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
const seedrandom = require('seedrandom');
const { generate_random_code } = require('../util/identifier');
const { Context } = require('../util/context');
const { get_user } = require('../helpers');
const { DB_WRITE } = require('./database/consts');
const BaseService = require('./BaseService');
const { UserIDNotifSelector } = require('./NotificationService');


/**
* Class ReferralCodeService
* 
* This class is responsible for managing the generation and handling of referral codes 
* within the application. It extends the BaseService and provides methods to initialize
* referral code generation for users, verify referrals, and manage updates to user 
* storage based on successful referrals. The service ensures that referral codes are 
* unique and properly assigned during user interactions.
*/
class ReferralCodeService extends BaseService {
    _construct () {
        this.REFERRAL_INCREASE_LEFT = 1 * 1024 * 1024 * 1024; // 1 GB
        this.REFERRAL_INCREASE_RIGHT = 1 * 1024 * 1024 * 1024; // 1 GB
        this.STORAGE_INCREASE_STRING = '1 GB';
    }


    /**
    * Initializes the ReferralCodeService by setting up event listeners
    * for user email confirmation. Listens for the 'user.email-confirmed' 
    * event and triggers the on_verified method when a user confirms their 
    * email address.
    *
    * @async
    * @returns {Promise<void>} A promise that resolves when initialization is complete.
    */
    async _init () {
        const svc_event = this.services.get('event');
        svc_event.on('user.email-confirmed', async (_, { user_uid }) => {
            const user = await get_user({ uuid: user_uid });
            await this.on_verified(user);
        });
    }


    /**
    * Generates a unique referral code for the specified user.
    * This method attempts to create a referral code and store it in the database.
    * It retries the generation process up to a predefined number of attempts if
    * any errors occur during the database write operation.
    * 
    * @param {Object} user - The user for whom the referral code is being generated.
    * @returns {Promise<string>} The generated referral code.
    * @throws Will throw an error if the user is missing or if the code generation fails after retries.
    */
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

        // Constant representing the number of attempts to generate a unique referral code.
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
                db.write(`
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


    /**
     * Handles the logic when a user is verified.
     * This method checks if the user has been referred by another user and updates
     * the storage of both the referring user and the newly verified user accordingly.
     * 
     * @param {Object} user - The user object representing the verified user.
     * @returns {Promise<void>} - A promise that resolves when the operation is complete.
     */
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
        });

        const svc_notification = Context.get('services').get('notification');
        svc_notification.notify(UserIDNotifSelector(referred_by.id), {
            source: 'referral',
            icon: 'c-check.svg',
            text: `You have referred user ${user.username} and ` +
                `have received ${this.STORAGE_INCREASE_STRING} of storage.`,
            template: 'referral',
            fields: {
                storage_increase: this.STORAGE_INCREASE_STRING,
                referred_username: user.username
            }
        });
    }
}

module.exports = {
    ReferralCodeService
};
