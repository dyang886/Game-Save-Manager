const fs = require('node:fs/promises');
const path = require('node:path');

// This database deliberately lives outside the downloaded game database. Payloads
// contain connection references and task metadata, never decrypted credentials.
class CloudStore {
    constructor(filename, { sqlite = require('sqlite3') } = {}) {
        this.filename = filename;
        this.sqlite = sqlite;
        this.tail = Promise.resolve();
    }

    async open() {
        await fs.mkdir(path.dirname(this.filename), { recursive: true });
        this.db = await new Promise((resolve, reject) => {
            const db = new this.sqlite.Database(this.filename, error => error ? reject(error) : resolve(db));
        });
        await this.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS cloud_records (collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(collection, id));');
        return this;
    }

    exec(sql) {
        return new Promise((resolve, reject) => this.db.exec(sql, error => error ? reject(error) : resolve()));
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => this.db.run(sql, params, error => error ? reject(error) : resolve()));
    }

    async get(collection, id) {
        await this.tail;
        const row = await new Promise((resolve, reject) => this.db.get('SELECT payload FROM cloud_records WHERE collection=? AND id=?', [collection, id], (error, result) => error ? reject(error) : resolve(result)));
        return row ? JSON.parse(row.payload) : null;
    }

    async list(collection) {
        await this.tail;
        const rows = await new Promise((resolve, reject) => this.db.all('SELECT payload FROM cloud_records WHERE collection=? ORDER BY id', [collection], (error, result) => error ? reject(error) : resolve(result)));
        return rows.map(row => JSON.parse(row.payload));
    }

    put(collection, id, value) {
        return this.batch([{ collection, id, value }]);
    }

    delete(collection, id) {
        return this.batch([{ collection, id, delete: true }]);
    }

    batch(operations) {
        const job = this.tail.then(async () => {
            await this.exec('BEGIN IMMEDIATE');
            try {
                for (const operation of operations) {
                    if (operation.delete) await this.run('DELETE FROM cloud_records WHERE collection=? AND id=?', [operation.collection, operation.id]);
                    else await this.run('INSERT INTO cloud_records(collection,id,payload) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload', [operation.collection, operation.id, JSON.stringify(operation.value)]);
                }
                await this.exec('COMMIT');
            } catch (error) {
                await this.exec('ROLLBACK').catch(() => {});
                throw error;
            }
        });
        this.tail = job.catch(() => {});
        return job;
    }

    async close() {
        await this.tail;
        if (this.db) await new Promise((resolve, reject) => this.db.close(error => error ? reject(error) : resolve()));
        this.db = null;
    }
}

module.exports = { CloudStore };
