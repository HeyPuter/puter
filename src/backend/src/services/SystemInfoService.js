const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const BaseService = require('./BaseService.js');

class SystemInfoService extends BaseService {
    static name () {
        return 'system_info';
    }

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

    async getServerDiskUsage () {
        try {
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
