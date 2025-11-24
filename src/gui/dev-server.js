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
import express from 'express';
import { generateDevHtml, build } from './utils.js';
import { argv } from 'node:process';
import chalk from 'chalk';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
let port = process.env.PORT ?? 4000; // Starting port
const maxAttempts = 10; // Maximum number of ports to try
const env = argv[2] ?? 'dev';

const startServer = (attempt, useAnyFreePort = false) => {
    if ( attempt > maxAttempts ) {
        useAnyFreePort = true; // Use any port that is free
    }

    const server = app.listen(useAnyFreePort ? 0 : port, () => {
        console.log('\n-----------------------------------------------------------\n');
        console.log('Puter is now live at: ', chalk.underline.blue(`http://localhost:${server.address().port}`));
        console.log('\n-----------------------------------------------------------\n');
    }).on('error', (err) => {
        if ( err.code === 'EADDRINUSE' ) { // Check if the error is because the port is already in use
            console.error(chalk.red(`ERROR: Port ${port} is already in use. Trying next port...`));
            port++; // Increment the port number
            startServer(attempt + 1); // Try the next port
        }
    });
};

// Start the server with the first attempt
startServer(1);

// build the GUI
build();

app.get(['/', '/app/*', '/action/*'], (req, res) => {
    res.send(generateDevHtml({
        env: env,
        api_origin: 'https://api.puter.com',
        title: 'Puter',
        max_item_name_length: 150,
        require_email_verification_to_publish_website: false,
        short_description: 'Puter is a privacy-first personal cloud that houses all your files, apps, and games in one private and secure place, accessible from anywhere at any time.',
    }));
});
app.use(express.static('./'));

if ( env === 'prod' ) {
    // make sure to serve the ./dist/ folder maps to the root of the website
    app.use(express.static('./dist/'));
}

if ( env === 'dev' ) {
    app.use(express.static('./src/'));
}

export { app };
