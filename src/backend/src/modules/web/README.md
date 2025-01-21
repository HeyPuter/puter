# WebModule

This module initializes a pre-configured web server and socket.io server.
The main service, WebServerService, emits 'install.routes' and provides
the server instance to the callback.

## Services

### SocketioService

SocketioService provides a service for sending messages to clients.
socket.io is used behind the scenes. This service provides a simpler
interface for sending messages to rooms or socket ids.

#### Listeners

##### `install.socketio`

Initializes socket.io

###### Parameters

- **server:**  The server to attach socket.io to.

### WebServerService

This class, WebServerService, is responsible for starting and managing the Puter web server.
It initializes the Express app, sets up middlewares, routes, and handles authentication and web sockets.
It also validates the host header and IP addresses to prevent security vulnerabilities.

#### Listeners

##### `boot.consolidation`

This method initializes the backend web server for Puter. It sets up the Express app, configures middleware, and starts the HTTP server.

##### `boot.activation`

Starts the web server and listens for incoming connections.
This method sets up the Express app, sets up middleware, and starts the server on the specified port.
It also sets up the Socket.io server for real-time communication.

##### `start.webserver`

This method starts the web server by listening on the specified port. It tries multiple ports if the first one is in use.
If the `config.http_port` is set to 'auto', it will try to find an available port in a range of 4100 to 4299.
Once the server is up and running, it emits the 'start.webserver' and 'ready.webserver' events.
If the `config.env` is set to 'dev' and `config.no_browser_launch` is false, it will open the Puter URL in the default browser.

## Notes

### Outside Imports

This module has external relative imports. When these are
removed it may become possible to move this module to an
extension.

**Imports:**
- `../../services/BaseService` (use.BaseService)
- `../../util/context.js`
- `../../services/BaseService.js`
- `../../config.js`
- `../../middleware/auth.js`
- `../../util/strutil.js`
- `../../fun/dev-console-ui-utils.js`
- `../../helpers.js`
- `../../fun/logos.js`
