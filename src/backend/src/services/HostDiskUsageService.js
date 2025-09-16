// METADATA // {"ai-commented":{"service":"xai"}}
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
const BaseService = require('./BaseService');
const { execSync } = require('child_process');
const config = require("../config");


/**
* The HostDiskUsageService class extends BaseService to provide functionality for monitoring
* and reporting disk usage on the host system. This service identifies the mount point or drive
* where the current process is running, and performs disk usage checks for that specific location.
* It supports different operating systems like macOS and Linux, with placeholders for future
* Windows support.
*
* @extends BaseService
*/
class HostDiskUsageService extends BaseService {
    static DESCRIPTION = `
        This service is responsible for identifying the mountpoint/drive
        on which the current process working directory is running, and then checking the 
        disk usage of that mountpoint/drive.
    `;


    /**
    * Initializes the service by determining the disk usage of the mountpoint/drive 
    * where the current working directory resides.
    * 
    * @async
    * @function
    * @memberof HostDiskUsageService
    * @instance
    * @returns {Promise<void>} A promise that resolves when initialization is complete.
    * @throws {Error} If unable to determine disk usage for the platform.
    */
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

        config.available_device_storage = free_space;
    }

    // TODO: TTL cache this value
    /**
    * Retrieves the current disk usage for the host system.
    * 
    * This method checks the disk usage of the mountpoint or drive
    * where the current process is running, based on the operating system.
    * 
    * @returns {number} The amount of disk space used in bytes.
    * 
    * @note This method does not cache its results and should be optimized
    *       with a TTL cache to prevent excessive system calls.
    */
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
    /**
    * Retrieves extra disk usage information for the host.
    * This method is used by the /df endpoint to gather
    * additional statistics on host disk usage.
    *
    * @returns {Object} An object containing the host's disk usage data.
    */
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

    // Get the total drive capacity on the mountpoint/drive in mac os
    get_disk_capacity_darwin(mountpoint) {
        const disk_info = execSync(`df -P "${mountpoint}" | awk 'NR==2 {print $2}'`, { encoding: 'utf-8' }).trim().split(' ');
        return parseInt(disk_info) * 512;
    }

    // Get the total drive capacity on the mountpoint/drive in linux
    get_disk_capacity_linux(mountpoint) {
        const disk_info = execSync(`df -P "${mountpoint}" | awk 'NR==2 {print $2}'`, { encoding: 'utf-8' }).trim().split(' ');
        return parseInt(disk_info) * 1024;
    }

    // Get the total drive capacity on the drive in windows
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
