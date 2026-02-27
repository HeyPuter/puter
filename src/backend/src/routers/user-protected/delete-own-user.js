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
const config = require('../../config');
const { deleteUser, invalidate_cached_user } = require('../../helpers');

const REVALIDATION_COOKIE_NAME = 'puter_revalidation';

module.exports = {
    route: '/delete-own-user',
    methods: ['POST'],
    handler: async (req, res) => {
        res.clearCookie(config.cookie_name);
        res.clearCookie(REVALIDATION_COOKIE_NAME);

        await deleteUser(req.user.id);
        invalidate_cached_user(req.user);

        return res.send({ success: true });
    },
};
