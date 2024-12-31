const capabilityNames = [
    // PuterFS Capabilities
    'thumbnail',
    'uuid',
    'operation-trace',
    'readdir-uuid-mode',

    // Standard Capabilities
    'read',
    'write',
    'symlink',
    'trash',

    // Behavior Capabilities
    'case-sensitive',

    // POSIX Capabilities
    'readdir-inode-numbers',
    'unix-perms',
];

const fsCapabilities = {};
for ( const capabilityName of capabilityNames ) {
    const key = capabilityName.toUpperCase().replace(/-/g, '_');
    fsCapabilities[key] = Symbol(capabilityName);
}

module.exports = fsCapabilities;
