const express = require("express")
const app = express()
const port = 4002;

app.listen(port, () => console.log(`The server is listening on http://localhost:${port}`))

app.use(express.static('./'));

module.exports = app;