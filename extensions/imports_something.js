console.log('importing something...');
const { testval } = extension.import('exports_something');
console.log(testval);

extension.on('hello', event => {
    console.log(`received "hello" from: ${event.from}`);
});
