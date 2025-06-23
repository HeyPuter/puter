function getUserInfo(authorization, apiBase = "https://puter.com") {
    return fetch(apiBase + "/whoami", { headers: { authorization, origin: "https://docs.puter.com" } }).then(async res => {
        if (res.status != 200) {
            throw ("User data endpoint returned error code " + await res.text());
            return;
        }

        return res.json();
    })
}

module.exports = {
    getUserInfo
}