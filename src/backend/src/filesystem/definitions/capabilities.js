const capabilityNames = [
    'thumbnail',
    'uuid',
    'operation-trace',

    'read',
    'write',
    'case-sensitive',
    'symlink',
    'unix-perms',
    'trash',
];

const fsCapabilities = {};
for ( const capabilityName of capabilityNames ) {
    const key = capabilityName.toUpperCase().replace(/-/g, '_');
    fsCapabilities[key] = Symbol(capabilityName);
}

module.exports = fsCapabilities;
