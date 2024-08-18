import { Service } from "../definitions.js";

export class AntiCSRFService extends Service {
    /**
     * Request an anti-csrf token from the server
     * @return anti_csrf: string
     */
    async token () {
        const anti_csrf = await (async () => {
            const resp = await fetch(
                `${window.gui_origin}/get-anticsrf-token`,{
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + window.auth_token,
                    }
                },)
            const { token } = await resp.json();
            return token;
        })();
        
        return anti_csrf;
    }
}
