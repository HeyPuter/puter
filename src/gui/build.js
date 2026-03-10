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
import { build } from './utils.js';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { Buffer } from 'node:buffer';

// eslint-disable-next-line no-undef
const argv = yargs(hideBin(process.argv)).parse();
if ( argv.assets_url ) {
    console.log('Extracting assets...');
    const assetsTar = Buffer.from(await fetch(argv.assets_url).then(r => r.arrayBuffer()));
    await fs.promises.writeFile('assets.tar.gz', assetsTar);
    if ( fs.existsSync('src/icons') ) {
        fs.promises.rename('src/icons', 'src/icons.old');
    }
    execSync('tar -xzvf assets.tar.gz');
    fs.promises.rm('assets.tar.gz');
}

build();
