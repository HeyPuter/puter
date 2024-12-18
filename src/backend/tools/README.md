# Backend Tools Directory

## Test Kernel

The **Test Kernel** is a drop-in replacement for Puter's main kernel. Instead of
actually initializing and running services, it only registers them and then invokes
a test iterator through all the services.

The Test Kernel is ideal for running unit and integration tests against individual services, ensuring they behave correctly.

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
