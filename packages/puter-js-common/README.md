# Puter - Common Javascript Module

This is a small module for javascript which you might call a
"language tool"; it adds some behavior to make javascript classes
more flexible, with an aim to avoid any significant complexity.

Each class in this module is best described as an _idea_:

### BasicBase

**BasicBase** is the idea that there should be a common way to
see the inheritance chain of the current instance, and obtain
merged objects and arrays from static members of these classes.

### TraitBase

**TraitBase** is the idea that there should be a common way to
"install" behavior into objects of a particular class, as
dictated by the class definition. A trait might install a common
set of methods ("mixins"), decorate all or a specified set of
methods in the class (performance monitors, sanitization, etc),
or anything else.

### AdvancedBase

**AdvancedBase** is the idea that, in a node.js environment,
you always want the ability to add traits to a class and there
are some default traits you want in all classes, which are:

- `PropertiesTrait` - add lazy factories for instance members
  instead of always populating them in the constructor.
- `NodeModuleDITrait` - require node modules in a way that
  allows unit tests to inject mocks easily.
