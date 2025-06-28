# Documentation for Robots

Hello, if you're an AI agent then you're reading the correct documentation.
Here are a few important notes:
- Puter is probably already cloned and configured, so avoid any setup
  or configuration steps unless explicitly asked to perform them.
- Anything under `/src` (relative to the root of the repo) is probably
  a workspace module. That means different directories might have different
  code styles or use different import mechanisms (ESM vs CJS). Try to keep
  changes consistent in the scope of where they are.
  
# Backend

Any file under `src/backend` that extends **BaseService** is called a
"backend service". Backend services can implement "traits". That looks
like this:

```javascript
class SomeClass extends BaseService {
  static IMPLEMENTS = {
    ['name-of-interface']: {
      async some_method_name () {
        const instance_of_SomeClass = this;
      }
    }
  }
}
```

Methods on traits are bound to the same "this" (instance variable) as
methods on the class itself. Trait methods cannot be indexed from the
instance variable; instead common functionality is usually moved to
regular instance methods which typically have an underscore at the end
of their name.

# Furher Documentation
  
Proceed to read the README.md document beside this file.
