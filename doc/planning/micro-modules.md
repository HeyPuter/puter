# Micro Modules

**CoreModule** has a large number of services. Each service handles
a general concern, like "notifications", but increasing this granularity
a little put more could allow a lot more code re-use.

One specific example that comes to mind is services that provide
CRUD operations for a database table. The **EntityStoreService** can
be used for a lot of these even though right now it's specifically
used for drivers. Having a common class of service like this can also
allow quickly configuring the equivalent service for providing those
CRUD operations through an API.
