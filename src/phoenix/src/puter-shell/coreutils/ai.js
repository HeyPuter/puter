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
    input: {
        synchLines: true,
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
                    role: 'system',
                    content: `You are a helpful AI assistant that helps users with shell commands.
                    When a user asks to perform an action:
                    1. If the action requires a command, wrap ONLY the command between %%% markers
                    2. Keep the command simple and on a single line
                    3. Do not ask for confirmation
                    Example:
                    User: "create a directory named test"
                    You: "Creating directory 'test'
                    %%%mkdir test%%%"`
                },
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

        const commandMatch = message.match(/%%%(.*?)%%%/);

        if (commandMatch) {
            const commandToExecute = commandMatch[1].trim();
            const cleanMessage = message.replace(/%%%(.*?)%%%/, '');

            await ctx.externs.out.write(cleanMessage + '\n');

            await ctx.externs.out.write(`Execute command: '${commandToExecute}' (y/n): `);

            try {
                let line, done;
                const next_line = async () => {
                    ({ value: line, done } = await ctx.externs.in_.read());
                }

                await next_line();

                const inputString = new TextDecoder().decode(line);
                const response = (inputString ?? '').trim().toLowerCase();

                console.log('processed response', {response});

                if (!response.startsWith('y')) {
                    await ctx.externs.out.write('\nCommand execution cancelled\n');
                    return; 
                }

                await ctx.externs.out.write('\n');
                await ctx.shell.runPipeline(commandToExecute);
                await ctx.externs.out.write(`Command executed: ${commandToExecute}\n`);
            } catch (error) {
                await ctx.externs.err.write(`Error executing command: ${error.message}\n`);
                return; 
            }
        } else {
            await ctx.externs.out.write(message + '\n');
        }

    }
}
