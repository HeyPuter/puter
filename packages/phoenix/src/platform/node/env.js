import os from 'os';

export const CreateEnvProvider = () => {
    return {
        getEnv: () => {
            let env = process.env;
            if ( ! env.PS1 ) {
                env.PS1 = `[\\u@\\h \\w]\\$ `;
            }
            if ( ! env.HOSTNAME ) {
                env.HOSTNAME = os.hostname();
            }
            return env;
        },

        get (k) {
            return this.getEnv()[k];
        }
    }
}
