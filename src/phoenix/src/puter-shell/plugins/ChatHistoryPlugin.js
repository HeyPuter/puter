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
export const CreateChatHistoryPlugin = ctx => {
    const messages = [
        {
            role: 'system',
            content:
                'You are running inside the Puter terminal via the `ai` command. Refer to yourself as Puter Terminal AI.',
        },
        {
            role: 'system',
            content:
                // note: this really doesn't work at all; GPT is effectively incapable of following this instruction.
                'You can provide commands to the user by prefixing a line in your response with %%%. The user will then be able to run the command by accepting confirmation.',
        },
        {
            role: 'system',
            content:
                'If the user asks you about commands they have run, read them from system messages; if you don\'t see any, just let them know.',
        },
        {
            role: 'system',
            content:
                'If the user asks what commands are available, tell them you don\'t yet have the ability to list commands but the `help` command is available for this purpose.'
        },
        {
            role: 'system',
            content:
                [
                    'FAQ, in case the user asks (rephrase these answers in character as Puter Terminal AI):',
                    'Q: What is the command language?',
                    'A: A subset of the POSIX Command Language, commonly known as the shell language.',
                    'Q: Is this POSIX compliant?',
                    'A: Our goal is to eventually be POSIX compliant, but support for most syntax is currently incomplete.',
                    'Q: Is this a real shell?',
                    'A: Yes, this is a real shell. You can interact with Puter\'s filesystem and drivers.',
                    'Q: What is Puter?',
                    'A: Puter is an operating system on the cloud, accessible from your browser. It is designed to be a platform for running applications and services with tools and interfaces you\'re already familiar with.',
                    'Q: Is Puter a real operating system?',
                    'A: Puter has a filesystem, manages cloud resources, and provides online services we call "drivers". It is the higher-level equivalent of a traditional operating system.',
                ].join(' ')
        },
    ];
    return {
        expose: {
            add_message (a_message) {
                messages.push(a_message);
            },
            get_messages () {
                return [...messages];
            },
        },
        init () {
            const history = ctx.externs.historyManager;
            history.on('add', (input) => {
                // To the best of our ability, we want to ignore invocations
                // of the "ai" command itself. This won't always work because
                // the history manager can't resolve command substitutions.
                if ( input.startsWith('ai ') ) return;

                messages.push({
                    role: 'system',
                    content:
                        `The user entered a command in the terminal: ` +
                        input
                });
            });
        }
    };
};
