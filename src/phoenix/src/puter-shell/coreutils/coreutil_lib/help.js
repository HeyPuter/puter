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
import { wrapText } from '../../../util/wrap-text.js';

const TAB_SIZE = 8;

export const DEFAULT_OPTIONS = {
    help: {
        description: 'Display this help text, and exit',
        type: 'boolean',
    },
};

export const printUsage = async (command, out, vars) => {
    const { name, usage, description, args, helpSections } = command;
    const options = Object.create(DEFAULT_OPTIONS);
    Object.assign(options, args.options);

    const heading = async text => {
        await out.write(`\x1B[34;1m${text}:\x1B[0m\n`);
    };
    const colorOption = text => {
        return `\x1B[92m${text}\x1B[0m`;
    };
    const colorOptionArgument = text => {
        return `\x1B[91m${text}\x1B[0m`;
    };
    const wrap = text => {
        return `${wrapText(text, vars.size.cols).join('\n') }\n`;
    };

    await heading('Usage');
    if ( ! usage ) {
        let output = name;
        if ( options ) {
            output += ' [OPTIONS]';
        }
        if ( args.allowPositionals ) {
            output += ' INPUTS...';
        }
        await out.write(`  ${output}\n\n`);
    } else if ( typeof usage === 'string' ) {
        await out.write(`  ${usage}\n\n`);
    } else {
        for ( const line of usage ) {
            await out.write(`  ${line}\n`);
        }
        await out.write('\n');
    }

    if ( description ) {
        await out.write(wrap(description));
        await out.write('\n');
    }

    if ( options ) {
        await heading('Options');

        for ( const optionName in options ) {
            let optionText = '  ';
            let indentSize = optionText.length;
            const option = options[optionName];
            if ( option.short ) {
                optionText += `${colorOption(`-${ option.short}`) }, `;
                indentSize += `-${option.short}, `.length;
            } else {
                optionText += '    ';
                indentSize += '    '.length;
            }
            optionText += colorOption(`--${optionName}`);
            indentSize += `--${optionName}`.length;
            if ( option.type !== 'boolean' ) {
                const valueName = option.valueName || 'VALUE';
                optionText += `=${colorOptionArgument(valueName)}`;
                indentSize += `=${valueName}`.length;
            }
            if ( option.description ) {
                const indentSizeIncludingTab = (size) => {
                    return (Math.floor(size / TAB_SIZE) + 1) * TAB_SIZE + 1;
                };

                // Wrap the description based on the terminal width, with each line indented.
                let remainingWidth = vars.size.cols - indentSizeIncludingTab(indentSize);
                let skipIndentOnFirstLine = true;

                // If there's not enough room after a very long option name, start on the next line.
                if ( remainingWidth < 30 ) {
                    optionText += '\n';
                    indentSize = 8;
                    remainingWidth = vars.size.cols - indentSizeIncludingTab(indentSize);
                    skipIndentOnFirstLine = false;
                }

                const wrappedDescriptionLines = wrapText(option.description, remainingWidth);
                for ( const line of wrappedDescriptionLines ) {
                    if ( skipIndentOnFirstLine ) {
                        skipIndentOnFirstLine = false;
                    } else {
                        optionText += ' '.repeat(indentSize);
                    }
                    optionText += `\t ${line}\n`;
                }
            } else {
                optionText += '\n';
            }
            await out.write(optionText);
        }
        await out.write('\n');
    }

    if ( helpSections ) {
        for ( const [title, contents] of Object.entries(helpSections) ) {
            await heading(title);
            await out.write(wrap(contents));
            await out.write('\n\n');
        }
    }
};