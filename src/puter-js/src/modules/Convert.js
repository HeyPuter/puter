class Convert {
    constructor(context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID;
    }

    setAuthToken(authToken) {
        this.authToken = authToken;
    }

    setAPIOrigin(APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    convert = async (...args) => {
        let options = {};

        // If args is a single object, assume it is the options object
        if (typeof args[0] === 'object' && args[0] !== null) {
            options = args[0];
        } else {
            // Otherwise, we assume separate arguments are provided
            options = {
                source: args[0],
                to: args[1],
                success: args[2],
                error: args[3],
            };
        }

        try {
            const response = await fetch(`${this.APIOrigin}/drivers/call`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    interface: 'convert-files',
                    method: 'convert',
                    args: {
                        source: options.source,
                        to: options.to
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Conversion failed');
            }

            // Get the blob from the response
            const blob = await response.blob();

            if (options.success && typeof options.success === 'function') {
                options.success(blob);
            }

            return blob;

        } catch (error) {
            if (options.error && typeof options.error === 'function') {
                options.error(error);
            }
            throw error;
        }
    }
}

export default Convert;