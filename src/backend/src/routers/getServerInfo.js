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
const eggspress = require('../api/eggspress');
const os = require('os');
const fs = require('fs/promises');

module.exports = eggspress(['/getServerInfo'], {
    allowedMethods: ['GET'],
    subdomain: 'api',
    json: true,
}, async (req, res, next) => {

    console.log('Hostname:', os.hostname());

    console.log('OS Platform:', os.platform());
    console.log('OS Type:', os.type());
    console.log('OS Release:', os.release());

    const cpus = os.cpus();
    console.log('CPU Count:', cpus.length);
    console.log('CPU Model (first core):', cpus[0].model);

    const totalMemGB = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
    const freeMemGB = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
    console.log('Total RAM (GB):', totalMemGB);
    console.log('Free RAM (GB):', freeMemGB);

    const uptimeSeconds = os.uptime();
    console.log('Uptime (seconds):', uptimeSeconds);
    // Manual format example (days, hours, mins)
    const days = Math.floor(uptimeSeconds / (3600 * 24));
    const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
    const mins = Math.floor((uptimeSeconds % 3600) / 60);
    console.log('Formatted Uptime:', `${days}d ${hours}h ${mins}m`);
    // res.send(response);

    const stats = await fs.statfs('/'); // or process.cwd() for current dir's filesystem
    const totalGB = (stats.blocks * stats.bsize / (1024 * 1024 * 1024)).toFixed(2);
    const freeGB = (stats.bfree * stats.bsize / (1024 * 1024 * 1024)).toFixed(2);
    const usedGB = (totalGB - freeGB).toFixed(2);
    console.log('Disk Total (GB):', totalGB);
    console.log('Disk Free (GB):', freeGB);
    console.log('Disk Used (GB):', usedGB);

    os.loadavg();
    console.log(os.loadavg());

    console.log('Fetched server info successfully.');
    res.send('response');
});
