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
import { Exit } from './coreutil_lib/exit.js';

export default {
    name: 'login',
    usage: 'login',
    description: 'Log in to a Puter.com account.',
    args: {
        $: 'simple-parser',
        allowPositionals: false,
    },
    execute: async ctx => {
        // ctx.params to access processed args
        // ctx.args to access raw args
        const { positionals, values } = ctx.locals;
        const { puterSDK } = ctx.externs;

        console.log('this is athe puter sdk', puterSDK);

        if ( puterSDK.APIOrigin === undefined ) {
            await ctx.externs.err.write('login: API origin not set\n');
            throw new Exit(1);
        }

        const res = await puterSDK.auth.signIn();

        ctx.vars.user = res?.username;
        ctx.vars.home = '/' + res?.username;
        ctx.vars.pwd = '/' + res?.username + `/AppData/` + puterSDK.appID;

        return res?.username;
    }
}
