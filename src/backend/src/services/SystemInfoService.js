const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const BaseService = require('./BaseService');

/**
* SystemInfoService class extends BaseService to provide server-side system information.
* It aggregates CPU, Memory, OS, and Disk usage statistics into a single response object.
* This service is designed to support the System Information UI by exposing backend specs.
*
* @extends BaseService
*/
class SystemInfoService extends BaseService {
    static name () {
        return 'system_info';
    }

    /**
    * Retrieves the current system statistics.
    * Aggregates data from Node.js 'os' module and system commands.
    *
    * @async
    * @returns {Promise<Object>} An object containing os, cpu, memory, uptime, and disk stats.
    */
    async getStats () {
        const cpus = os.cpus();
        const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown';

        return {
            os: {
                platform: os.platform(),
                distro: os.type(),
                release: os.release(),
            },
            cpu: {
                model: cpuModel,
                cores: cpus.length,
                load_avg: os.loadavg(),
            },
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                // Calculate used memory
                used: os.totalmem() - os.freemem(),
            },
            uptime: os.uptime(),
            disk: await this.getServerDiskUsage(),
        };
    }

    /**
    * Retrieves disk usage for the root file system.
    * Uses the 'df' command to fetch used and available space.
    *
    * @async
    * @returns {Promise<Object|null>} An object with total_kb, used_kb, and available_kb, or null if parsing fails.
    */
    async getServerDiskUsage () {
        try {
            // 'df -k /' works on Linux/macOS to get root partition usage
            const { stdout } = await execAsync('df -k /');
            const lines = stdout.trim().split('\n');
            if ( lines.length < 2 ) return null;

            const parts = lines[1].split(/\s+/);

            return {
                total_kb: parseInt(parts[1]),
                used_kb: parseInt(parts[2]),
                available_kb: parseInt(parts[3]),
                usage_percent: parts[4],
            };
        } catch ( error ) {
            return { error: 'Unavailable' };
        }
    }
}

module.exports = { SystemInfoService };