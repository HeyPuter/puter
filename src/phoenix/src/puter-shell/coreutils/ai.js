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
    name: 'ai',
    usage: 'ai PROMPT',
    description: 'Send PROMPT to Puter\'s AI chatbot, and print its response.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
    },
    execute: async ctx => {
        const { positionals } = ctx.locals;
        const [ prompt ] = positionals;

        if ( ! prompt ) {
            await ctx.externs.err.write('ai: missing prompt\n');
            throw new Exit(1);
        }
        if ( positionals.length > 1 ) {
            await ctx.externs.err.write('ai: prompt must be wrapped in quotes\n');
            throw new Exit(1);
        }

        const { drivers } = ctx.platform;
        const { chatHistory } = ctx.plugins;

        let a_interface, a_method, a_args;

        a_interface = 'puter-chat-completion';
        a_method = 'complete';
        a_args = {
            messages: [
                ...chatHistory.get_messages(),
                {
                    role: 'user',
                    content: prompt,
                }
            ],
        };

        console.log('THESE ARE THE MESSAGES', a_args.messages);

        const result = await drivers.call({
            interface: a_interface,
            method: a_method,
            args: a_args,
        });

        const resobj = JSON.parse(await result.text(), null, 2);

        if ( resobj.success !== true ) {
            await ctx.externs.err.write('request failed\n');
            await ctx.externs.err.write(resobj);
            return;
        }

        const message = resobj?.result?.message?.content;

        if ( ! message ) {
            await ctx.externs.err.write('message not found in response\n');
            await ctx.externs.err.write(result);
            return;
        }

        chatHistory.add_message(resobj?.result?.message);

        await ctx.externs.out.write(message + '\n');
    }
}
