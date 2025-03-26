# Backend Style

## File Structure

### Copyright Notice

All files should begin with the standard copyright notice:

```javascript
/*
 * Copyright (C) 2025-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
```

### Imports

```javascript
const express = require('express');
const passport = require('passport');

const { get_user } = require("../../helpers");
const BaseService = require("../../services/BaseService");
const config = require("../../config");

const path = require('path');
const fs = require('fs');
```

Import order is generally:
1. Third party dependencies. Having these occur first makes it easy to quickly
   determine what this source file is likely to be responsible for.
2. Files within the module.
3. Standard library, "builtins"

## Code Formatting

### Indentation and Spacing

```javascript
const fn = async () => {
    const a = 5; // Spaces between operators

    // Note: "=" in for loop initializer does not require space around
    // Note: operators in condition part have space around
    for ( let i=0; i < 10; i++ ) {
        console.log('hello');
    }
    
    // Control structures have space inside parenthesis
    for ( const thing of stuff ) {
        // NOOP
    }
    
    // Function calls do not have space inside parenthesis
    await something(1, 2);
}
```

- Use 4 spaces for indentation.
- Use spaces around operators (`=`, `+`, etc.); not required in
  for loop initializer.
- Use a space after keywords like `if`, `for`, `while`, etc.
  ```javascript
  return [1,2,3]; // Sure
  return[1,2,4];  // Definitely not
  ```
- Use spaces between parenthesis in control structures unless
  parenthesis are empty.
  ```javascript
  if ( a === b ) {
    return null;
  }
  ```
- No trailing whitespace at the end of lines
- Use a space after commas in arrays and objects
- Empty blocks should have the comment `// NOOP` within braces

### Line Length

- Try to keep lines under 100 characters for better readability
  - Try to keep them under 80, but this is not always practical
- For long function calls or objects, break them into multiple lines


### Trailing Commas

```javascript
// This is great
{
    "apple",
    "banana",
    "cactus", // <-- Good!
}

// This is also fine
[
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
]

[
    something(),
    another_thing(),
    the_last_thing() // <-- Nope, please add trailing comma!
]
```

We use trailing commas where applicable because it's easier to re-order
lines, especially when using vim motions.

### Braces and Blocks

- Single statement blocks must either be on the same line as
  the corresponding control structure, or surrounding by braces:
  ```javascript
  if ( a === b ) return null; // Sure
  if ( a === b )
      return null; // Please no 🤮
  if ( a === b ) {
      return null; // Nice
  }
  ```
- Opening braces go on the same line as the statement
- Put a space before the opening brace


## Naming Conventions

### Variables

- Variables are generally in camelCase
- Variables might have a prefix_beforeThem

```javascript
const svc_systemData = this.services.get('system-data');
const svc_su = this.services.get('su');
effective_policy = await svc_su.sudo(async () => {
    return await svc_systemData.interpret(effective_policy.data);
});
```

In the example above we see the `svc_` prefix is used to indicate a
reference to a backend service. The name of the service is `system-data`
which is not a valid identifier, so we use `svc_systemData` for our
variable name.

### Classes

- Use PascalCase for class names
- Use snake_case for class methods
- Instance variables are often `snake_case` because it's easier to
  read. `camelCase` is acceptable too.
- Instance variables only used internally should have a
  `trailing_underscore_` even if in `camelCase_`. We avoid using
  `#privateProperties` because it unnecessarily inhibits debugging
  and patching.

### File Names

- Use PascalCase for class files (e.g., `UserService.js`)
- Use kebab-case for non-class files (e.g., `auth-helper.js`)

## Documentation

### JSDoc Comments

- Backend services (classes extending `BaseService`) should have JSDoc comments
- Public methods of backend services should have JSDoc comments
- Include parameter descriptions, return values, and examples where appropriate

```javascript
/**
 * @class UserService
 * @description Service for managing user operations
 */

/**
 * Get a user by their ID
 * @param {string} id - The user ID
 * @returns {Promise<Object>} The user object
 * @throws {Error} If user not found
 */
async function getUserById(id) {
    // ...
}
```

### Inline Comments

- Use inline comments to explain complex logic
- Prefix comments with tags like `track:` to indicate specific purposes

```javascript
// track: slice a prefix
const uid = uid_part.slice('uid#'.length);
```
