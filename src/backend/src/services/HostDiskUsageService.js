const { BaseService } = require("../../exports");
const { execSync } = require('child_process');
const config = require("../config");

class HostDiskUsageService extends BaseService {
    static DESCRIPTION = `
        This service is responsible for identifying the mountpoint/drive
        on which the current process working directory is running, and then checking the 
        disk usage of that mountpoint/drive.
    `;

    async _init() {
        const current_platform = process.platform;

        // Setting the available space to a large number for unhandled platforms 
        var free_space = 1e+14;

        if (current_platform == "darwin") {
            const mountpoint = this.get_darwin_mountpoint(process.cwd());
            free_space = this.get_disk_capacity_darwin(mountpoint);
        } else if (current_platform == "linux") {
            const mountpoint = this.get_linux_mountpint(process.cwd());
            free_space = this.get_disk_capacity_linux(mountpoint);
        } else if (current_platform == "win32") {
            this.log.warn('HostDiskUsageService: Windows is not supported yet');
            // TODO: Implement for windows systems
        }

        console.log('free_space:', free_space);
        config.available_device_storage = free_space;
    }

    // TODO: TTL cache this value
    get_host_usage () {
        const current_platform = process.platform;

        let disk_use = 0;
        if (current_platform == "darwin") {
            const mountpoint = this.get_darwin_mountpoint(process.cwd());
            disk_use = this.get_disk_use_darwin(mountpoint);
        } else if (current_platform == "linux") {
            const mountpoint = this.get_linux_mountpint(process.cwd());
            disk_use = this.get_disk_use_linux(mountpoint);
        } else if (current_platform == "win32") {
            this.log.warn('HostDiskUsageService: Windows is not supported yet');
            // TODO: Implement for windows systems
        }
        return disk_use;
    }

    // Called by the /df endpoint
    get_extra () {
        return {
            host_used: this.get_host_usage(),
        };
    }


    // Get the mountpoint/drive of the current working directory in mac os
    get_darwin_mountpoint(directory) {
        return execSync(`df -P "${directory}" | awk 'NR==2 {print $6}'`, { encoding: 'utf-8' }).trim();
    }

    // Get the mountpoint/drive of the current working directory in linux
    get_linux_mountpint(directory) {
        return execSync(`df -P "${directory}" | awk 'NR==2 {print $6}'`, { encoding: 'utf-8' }).trim();
        // TODO: Implement for linux systems
    }

    // Get the drive of the current working directory in windows
    get_windows_drive(directory) {
        // TODO: Implement for windows systems
    }

    // Get the free space on the mountpoint/drive in mac os
    get_disk_capacity_darwin(mountpoint) {
        const disk_info = execSync(`df -P "${mountpoint}" | awk 'NR==2 {print $2}'`, { encoding: 'utf-8' }).trim().split(' ');
        return parseInt(disk_info) * 512;
    }

    // Get the free space on the mountpoint/drive in linux
    get_disk_capacity_linux(mountpoint) {
        const disk_info = execSync(`df -P "${mountpoint}" | awk 'NR==2 {print $2}'`, { encoding: 'utf-8' }).trim().split(' ');
        return parseInt(disk_info) * 1024;
    }

    // Get the free space on the drive in windows
    get_disk_capacity_windows(drive) {
        // TODO: Implement for windows systems
    }

    // Get the free space on the mountpoint/drive in mac os
    get_disk_use_darwin(mountpoint) {
        const disk_info = execSync(`df -P "${mountpoint}" | awk 'NR==2 {print $4}'`, { encoding: 'utf-8' }).trim().split(' ');
        return parseInt(disk_info) * 512;
    }

    // Get the free space on the mountpoint/drive in linux
    get_disk_use_linux(mountpoint) {
        const disk_info = execSync(`df -P "${mountpoint}" | awk 'NR==2 {print $4}'`, { encoding: 'utf-8' }).trim().split(' ');
        return parseInt(disk_info) * 1024;
    }

    // Get the free space on the drive in windows
    get_disk_use_windows(drive) {
        // TODO: Implement for windows systems
    }
}

module.exports = HostDiskUsageService;
