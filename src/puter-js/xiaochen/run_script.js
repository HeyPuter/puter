const main = require('./script_from_neal.cjs');

main()
  .then(puter => {
    console.log('Puter loaded successfully:', puter);
  })
  .catch(error => {
    console.error('Error:', error);
  });
