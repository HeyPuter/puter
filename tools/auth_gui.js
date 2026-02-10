import open from 'open';
import http from 'node:http';

export default function (guiOrigin = 'https://puter.com') {

    return new Promise((resolve) => {
        const requestListener = function (/**@type {IncomingMessage} */ req, res) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<script>window.location.href="http://puter.localhost:4100/?api_origin=https://api.puter.com&auth_token=" + new URL(location.href).searchParams.get("token") </script>');

            resolve(new URL(req.url, 'http://localhost/').searchParams.get('token'));
        };
        const server = http.createServer(requestListener);
        server.listen(0, function () {
            const url = `${guiOrigin}/?action=authme&redirectURL=${encodeURIComponent('http://localhost:') + this.address().port}`;
            open(url);
        });
    });
};
