/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
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
import { AddressRange } from './address.js';
import * as Commands from './command.js';
import { Script } from './script.js';

export const parseScript = (scriptString) => {
    const commands = [];

    // Generate a hard-coded script for now.
    // TODO: Actually parse input!

    commands.push(new Commands.SubstituteCommand(new AddressRange(), /Puter/, 'Frogger', new Commands.SubstituteFlags()));
    commands.push(new Commands.ConditionalBranchCommand(new AddressRange(), 'yay', true));
    commands.push(new Commands.ConditionalBranchCommand(new AddressRange(), 'nay', false));
    commands.push(new Commands.AppendTextCommand(new AddressRange(), 'HELLO!'));
    commands.push(new Commands.LabelCommand('yay'));
    commands.push(new Commands.PrintCommand(new AddressRange()));
    commands.push(new Commands.BranchCommand(new AddressRange(), 'end'));
    commands.push(new Commands.LabelCommand('nay'));
    commands.push(new Commands.AppendTextCommand(new AddressRange(), 'NADA!'));
    commands.push(new Commands.LabelCommand('end'));

    // commands.push(new TransliterateCommand(new AddressRange(), 'abcdefABCDEF', 'ABCDEFabcdef'));
    // commands.push(new ZapCommand(new AddressRange({start: new Address(1), end: new Address(10)})));
    // commands.push(new HoldAppendCommand(new AddressRange({start: new Address(1), end: new Address(10)})));
    // commands.push(new GetCommand(new AddressRange({start: new Address(11)})));
    // commands.push(new DebugPrintCommand(new AddressRange()));

    // commands.push(new ReplaceCommand(new AddressRange({start: new Address(3), end: new Address(30)}), "LOL"));

    // commands.push(new GroupCommand(new AddressRange({ start: new Address(5), end: new Address(10) }), [
    //     // new LineNumberCommand(),
    //     // new TextCommand(new AddressRange({ start: new Address(8) }), "Well hello friends! :^)"),
    //     new QuitCommand(new AddressRange({ start: new Address(8) })),
    //     new NoopCommand(new AddressRange()),
    //     new PrintCommand(new AddressRange({ start: new Address(2), end: new Address(14) })),
    // ]));

    // commands.push(new LineNumberCommand(new AddressRange({ start: new Address(5), end: new Address(10) })));
    // commands.push(new PrintCommand());
    // commands.push(new NoopCommand());
    // commands.push(new PrintCommand());

    return new Script(commands);
}
