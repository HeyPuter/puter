# Backend Tools Directory

## Test Kernel

The **Test Kernel** is a drop-in replacement for Puter's main kernel. Instead of
actually initializing and running services, it only registers them and then invokes
a test iterator through all the services.

The Test Kernel is ideal for running unit and integration tests against individual services, ensuring they behave correctly.

### Usage

```
node src/backend/tools/test`
```

### Testing Services

Implement the method `_test` on any service. When `_test` is called the "construct"
phase has already completed (meaning `_construct` on your service has been called
by now if you've implemented it), but the "init" phase will never happen (so _init
is never called).

> **TODO:** I want to add support for mocking `_init` for deeper testing.

For example, it should look similar to this snippet:

```javascript
class ExampleService extends BaseService {
    // ...
    async _test ({ assert }) {
      assert.equal('actual', 'expected', 'rule should have a description');
    }
}
```

Notice the parameter `assert` - this holds the TestKernel's testing API. The
reason this is a named parameter is to leave room for future support of
multiple testing APIs if this is ever desired or we decide to migrate
incrementally.

The last parameter to `assert.equal` is a message describing the test rule.
The message should always be a short statement with minimal punctuation.

#### TestKernel's testing API

The `assert` value here is a function that also has other methods defined
in its properties. When called directly, `assert` will run the callback you
provide as an assertion. When no `name` parameter is specified, the callback
itself will be printed as the name of the assertion - this is useful for
very short expressions which are self-descriptive.

```javascript
class ExampleService extends BaseService {
    // ...
    async _test ({ assert }) {
        assert(() => 1 === 2, 'one should equal two');
        assert.equal(1, 2, 'one should equal two')
        assert(() => 3 === 4); // prints out as: `() => 3 === 4`
    }
}
```

| Method         | Parameters                      | Types                                             | Description                                                                                                                       |
|----------------|---------------------------------|---------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| `assert`       | `callback`, `name?`             | `callback: () => boolean`, `name?: string`        | Runs the callback as an assertion. If `name` is omitted, the callback's source text is used as the printed name of the assertion. |
| `assert.equal` | `actual`, `expected`, `message` | `actual: any`, `expected: any`, `message: string` | Asserts that `actual === expected`. The final parameter is a short descriptive message for the test rule.                         |



### Test Kernel Notes

1. **Logging**:  
   A custom `TestLogger` is provided for simplified logging output during tests.
   Since LogService is never initialized, this is never replaced.

2. **Context Management**:  
   The Test Kernel uses the same `Context` system as the main Kernel. This gives test environments a consistent way to access global state, configuration, and service containers.

3. **Assertion & Results Tracking**:  
   The Test Kernel includes a simple testing structure that:
   - Tracks passed and failed assertions.
   - Repeats assertion outputs at the end of test runs for clarity.
   - Allows specifying which services to test via command-line arguments.

### Typical Workflow

1. **Initialization**:  
   Instantiate the Test Kernel, and add any modules you want to test.
   
2. **Module Installation**:  
   The Test Kernel installs these modules (via `_install_modules()`), making their services available in the `Container`.

3. **Service Testing**:  
   After modules are installed, each service can be constructed and tested. Tests are implemented as `_test()` methods on services, using simple assertion helpers (`testapi.assert` and `testapi.assert.equal`).

4. **Result Summarization**:  
   Once all tests run, the Test Kernel prints a summary of passed and failed assertions, aiding quick evaluation of test outcomes.
