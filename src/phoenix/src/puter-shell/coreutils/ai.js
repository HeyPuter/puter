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

        const tools = [];

        const commands = await ctx.externs.commandProvider.list();

        for ( const command of commands ) {
            if ( command.args && command.args.options ) {
                const parameters = {
                    type: 'object',
                    properties: {},
                    required: [],
                };

                for ( const [optName, opt] of Object.entries(command.args.options) ) {
                    parameters.properties[optName] = {
                        type: opt.type === 'boolean' ? 'boolean' : 'string',
                        description: opt.description,
                        default: opt.default,
                    };
                }

                if ( command.args.allowPositionals ) {
                    parameters.properties.path = {
                        type: 'string',
                        description: 'Path or name to operate on',
                    };
                    parameters.required.push('path');
                }

                tools.push({
                    type: 'function',
                    function: {
                        name: command.name,
                        description: command.description,
                        parameters: parameters,
                        strict: true,
                    },
                });
            }
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
                    content: 'You are a helpful AI assistant that helps users with shell commands. Use the provided tools to execute commands. ',
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            tools: tools,
            stream: true,
        };

        console.log('THESE ARE THE MESSAGES', a_args.messages);

        const result = await drivers.call({
            interface: a_interface,
            method: a_method,
            args: a_args,
        });

        const responseText = await result.text();
        const lines = responseText.split('\n').filter(line => line.trim());

        let fullMessage = '';

        for ( const line of lines ) {
            try {
                const chunk = JSON.parse(line);

                if ( chunk.type === 'text' ) {
                    fullMessage += chunk.text;
                    await ctx.externs.out.write(chunk.text);
                }

                else if ( chunk.type === 'tool_use' && chunk.name ) {
                    const args = chunk.input;
                    const command = await ctx.externs.commandProvider.lookup(chunk.name);

                    if ( command ) {
                        let cmdString = chunk.name;

                        if ( command.args && command.args.options ) {
                            for ( const [optName, value] of Object.entries(args) ) {
                                if ( optName !== 'path' && value === true ) {
                                    cmdString += ` --${optName}`;
                                }
                            }
                        }

                        if ( args.path ) {
                            cmdString += ` ${args.path}`;
                        }

                        await ctx.externs.out.write(`\nExecuting: ${cmdString}\n`);
                        await ctx.externs.out.write('Proceed? (y/n): ');

                        let { value: line } = await ctx.externs.in_.read();
                        const inputString = new TextDecoder().decode(line);
                        const response = inputString.trim().toLowerCase();

                        await ctx.externs.out.write('\n');

                        if ( response.startsWith('y') ) {
                            try {
                                await ctx.shell.runPipeline(cmdString);

                                await drivers.call({
                                    interface: 'puter-chat-completion',
                                    method: 'complete',
                                    args: {
                                        messages: [
                                            ...chatHistory.get_messages(),
                                            {
                                                role: 'tool',
                                                tool_call_id: chunk.id,
                                                content: `Command executed successfully: ${cmdString}`,
                                            },
                                        ],
                                    },
                                });

                                fullMessage += `Command executed successfully: ${cmdString}`;
                            } catch ( error ) {
                                await ctx.externs.err.write(`Error executing command: ${error.message}\n`);
                                fullMessage += `Failed to execute command: ${error.message}`;
                                return;
                            }
                        } else {
                            await ctx.externs.out.write('Operation cancelled.\n');
                            fullMessage += 'Operation cancelled';
                        }
                    }
                }
            } catch ( error ) {
                await ctx.externs.err.write(`Error parsing chunk: ${error.message}\n`);
                throw new Exit(1);
            }
        }

        await ctx.externs.out.write('\n');

        if ( ! fullMessage ) {
            await ctx.externs.err.write('message not found in response\n');
            return;
        }

        chatHistory.add_message({
            role: 'assistant',
            content: fullMessage,
        });

    },

};