const vm = require('vm');

async function load_puterjs() {
    const goodContext = {}
    Object.getOwnPropertyNames(globalThis).forEach(name => { try { goodContext[name] = globalThis[name]; } catch { } })
    goodContext.globalThis = goodContext
    const code = await fetch("http://puter.localhost:4100/puter.js/v2").then(res => res.text());
    const context = vm.createContext(goodContext);
    const result = vm.runInNewContext(code, context);
    return goodContext.puter;
}

module.exports = load_puterjs;