import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

const share = async function (targetPath, options = {}) {
    // targetPath is required
    if (!targetPath) {
        throw new Error('No target path provided.');
    }

    // If targetPath is not provided or it's not starting with a slash, it means it's a relative path
    // in that case, we need to prepend the app's root directory to it
    targetPath = getAbsolutePathForApp(targetPath);

    // Extract options
    const recipients = options.recipients || [];
    const access = options.access || 'read';

    // Validate access level
    if (!['read', 'write'].includes(access)) {
        throw new Error('Invalid access level. Must be "read" or "write".');
    }

    // Validate recipients
    if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error('Recipients must be a non-empty array.');
    }

    // Prepare the share request
    const shareData = {
        recipients: recipients,
        shares: [
            {
                $: 'fs-share',
                path: targetPath,
                access: access,
            }
        ]
    };

    // Make the API call to share the file
    console.log(`api origin: ${puter.APIOrigin}`);
    const response = await fetch(`${puter.APIOrigin}/share`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${puter.authToken}`
        },
        body: JSON.stringify(shareData)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Share failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    return result;
};

export default share;
