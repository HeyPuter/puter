export function getUserInfo(authorization) {
    return fetch("https://api.puter.localhost:4100/whoami", { headers: { authorization } }).then(res => {
        if (res.status != 200) {
            response.status(403);
            response.send("User data endpoint returned error code");
            return;
        }

        console.log("hai")
        return res.json();
    }).catch(e => {
        console.log(e)
        throw response.status(500) && response.send("Unable to parse user data");
    });
}