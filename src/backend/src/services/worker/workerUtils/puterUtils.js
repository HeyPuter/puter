export function getUserInfo(authorization) {
    return fetch("http://api.puter.localhost:4100/whoami", { headers: { authorization, origin: "https://docs.puter.com" } }).then(async res => {
        if (res.status != 200) {
            throw ("User data endpoint returned error code " + await res.text());
            return;
        }

        return res.json();
    })
}