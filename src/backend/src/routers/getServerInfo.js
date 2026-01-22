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
    const osData = {
        platform: os.platform(),
        type: os.type(),
        release: os.release(),
        pretty: `${os.type()} ${os.release()}`,
    };

    const cpus = os.cpus();
    const cpuData = {
        model: cpus[0]?.model || 'Unknown',
        cores: cpus.length,
    };

    const ramData = {
        total: os.totalmem(),
        free: os.freemem(),
        totalGB: (os.totalmem() / 1073741824).toFixed(2),
        freeGB: (os.freemem() / 1073741824).toFixed(2),
    };

    const uptimeSeconds = os.uptime();
    const uptimeData = {
        seconds: uptimeSeconds,
        days: Math.floor(uptimeSeconds / 86400),
        hours: Math.floor((uptimeSeconds % 86400) / 3600),
        minutes: Math.floor((uptimeSeconds % 3600) / 60),
        pretty: `${Math.floor(uptimeSeconds / 86400)}d ${Math.floor((uptimeSeconds % 86400) / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
    };

    let diskData = { total: 'N/A', free: 'N/A', used: 'N/A' };
    try {
        const stats = await fs.statfs('/');
        const totalGB = (stats.blocks * stats.bsize / 1073741824).toFixed(2);
        const freeGB = (stats.bfree * stats.bsize / 1073741824).toFixed(2);
        const usedGB = (totalGB - freeGB).toFixed(2);
        diskData = { total: totalGB, free: freeGB, used: usedGB };
    } catch ( err ) {
        console.error('Disk stats error:', err);
    }

    const response = {
        os: osData,
        cpu: cpuData,
        ram: ramData,
        uptime: uptimeData,
        disk: diskData,
        loadavg: os.loadavg(),
        hostname: os.hostname(),
    };

    res.json(response);
});
