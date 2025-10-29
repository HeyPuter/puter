const load_puterjs = require('./load.cjs');

async function run(conf) {
  const puter = await load_puterjs();
  if (conf.token) {
    puter.setAuthToken(conf.token);
  } else {
    throw new Error('No token found in config file. Please add a "token" field to your config.yaml');
  }
  return;
};

module.exports = async registry => {
  const puter = await load_puterjs();
  if (registry.t?.conf?.token) {
    puter.setAuthToken(registry.t.conf.token);
  } else {
    throw new Error('No token found in config file. Please add a "token" field to your config.yaml');
  }

  registry.t.puter = puter;

  console.log('__entry__.js');
  require('./auth/__entry__.js')(registry);
};