import backend from '@heyputer/backend';

const {
    Kernel,
    CoreModule,
    DatabaseModule,
    PuterDriversModule,
    LocalDiskStorageModule,
    SelfhostedModule,
} = backend;

const k = new Kernel();
k.add_module(new CoreModule());
k.add_module(new DatabaseModule());
k.add_module(new PuterDriversModule());
k.add_module(new LocalDiskStorageModule());
k.add_module(new SelfhostedModule()),
k.boot();
