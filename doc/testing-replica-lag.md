# Testing against a lagging read replica

Some bugs only exist between a primary and a replica that has not caught up:
a row is deleted on the primary, a reader is served the old copy by the
replica, and writes referencing it then fail their foreign keys.

Local development runs on sqlite, which has neither a replica nor foreign-key
enforcement, so neither half of that can happen. Unit tests inject the driver
error instead. This setup runs the real thing: two MySQL servers in actual
replication, where `STOP REPLICA` freezes the follower on demand.

## Setup

Assumes the usual local `puter-mysql` container (mysql:8, port 3306,
`root`/`puter`). Start a follower on 3307:

```bash
docker run -d --name puter-mysql-replica \
  -e MYSQL_ROOT_PASSWORD=puter -e MYSQL_DATABASE=puter \
  -p 3307:3306 mysql:8 \
  --server-id=2 --log-bin=mysql-bin --relay-log=relay-bin

until docker exec puter-mysql-replica mysqladmin -uroot -pputer ping >/dev/null 2>&1
do sleep 2; done
```

Give the primary a replication user:

```bash
docker exec puter-mysql mysql -uroot -pputer -e "
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY 'replpass';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;"
```

Seed the follower and point it at the primary. `--source-data=2` records the
binlog coordinates the dump was taken at, which is where the follower starts:

```bash
docker exec puter-mysql mysqldump -uroot -pputer \
  --source-data=2 --single-transaction --databases puter > /tmp/primary.sql

grep -m1 'CHANGE REPLICATION SOURCE' /tmp/primary.sql
# -- CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='binlog.000006', SOURCE_LOG_POS=717382;

docker exec -i puter-mysql-replica mysql -uroot -pputer < /tmp/primary.sql

PRIMARY_IP=$(docker inspect puter-mysql \
  --format '{{.NetworkSettings.Networks.bridge.IPAddress}}')

docker exec puter-mysql-replica mysql -uroot -pputer -e "
STOP REPLICA; RESET REPLICA ALL;
CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='${PRIMARY_IP}', SOURCE_PORT=3306,
  SOURCE_USER='repl', SOURCE_PASSWORD='replpass',
  SOURCE_LOG_FILE='<file from above>', SOURCE_LOG_POS=<pos from above>,
  GET_SOURCE_PUBLIC_KEY=1;
START REPLICA;"
```

`GET_SOURCE_PUBLIC_KEY=1` is required because MySQL 8 defaults to
`caching_sha2_password` and this link has no TLS. Confirm both threads are up:

```bash
docker exec puter-mysql-replica mysql -uroot -pputer -e "SHOW REPLICA STATUS\G" \
  | grep -E 'Replica_IO_Running|Replica_SQL_Running:|Last_Error'
```

## Running

```bash
PUTER_TEST_REPLICA_LAG=1 npx vitest run \
  --config src/backend/vitest.config.ts \
  src/backend/stores/replicaLag.integration.test.ts
```

Without the env var the suite skips, so it stays inert in CI and for anyone
without the containers. It builds its own throwaway database
(`puter_replica_lag_verify`), runs the MySQL migrations into it, and drops it
afterwards — your dev data is never touched.

Container names are overridable via `PUTER_TEST_REPLICA_PRIMARY` and
`PUTER_TEST_REPLICA_FOLLOWER`.

## Writing a case

`freeze()` stops replication; everything after it exists only on the primary.
An `afterEach` thaws unconditionally, so a failing assertion cannot strand the
follower and starve later cases of their fixture rows.

```ts
const app = await makeApp(server, user.id);
await settle(); // let the follower catch up
await server.stores.app.getByUid(app.uid); // warm the cache

freeze(); // follower is now behind
await server.stores.app.delete(app.id); // primary only

expect(await server.stores.app.getByUid(app.uid)).toBeNull();
```

## Teardown

```bash
docker rm -f puter-mysql-replica
docker exec puter-mysql mysql -uroot -pputer -e "DROP USER IF EXISTS 'repl'@'%';"
```
