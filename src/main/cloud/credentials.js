const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SECRET_FIELDS = new Set(['username', 'password', 'accessKeyId', 'secretAccessKey', 'sessionToken', 'proxyUsername', 'proxyPassword']);

function validateSecrets(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CONFIG' });
    const secrets = {};
    for (const [key, text] of Object.entries(value)) {
        if (!SECRET_FIELDS.has(key) || typeof text !== 'string' || text.length > 16384) throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CONFIG' });
        secrets[key] = text;
    }
    return secrets;
}

class CredentialStore {
    constructor(filename, safeStorage) {
        this.filename = filename;
        this.safeStorage = safeStorage;
        this.encrypted = {};
        this.sessions = new Map();
        this.tail = Promise.resolve();
    }

    async open() {
        try {
            const record = JSON.parse(await fs.readFile(this.filename, 'utf8'));
            if (record.version !== 1 || !record.entries || typeof record.entries !== 'object' || Array.isArray(record.entries)) throw new Error('Invalid credential store');
            this.encrypted = record.entries;
        } catch (error) {
            if (error.code !== 'ENOENT') throw Object.assign(new Error('Cannot read protected credentials'), { code: 'CREDENTIALS_UNAVAILABLE' });
        }
        return this;
    }

    canPersist() {
        try {
            return Boolean(this.safeStorage?.isEncryptionAvailable()) && this.safeStorage?.getSelectedStorageBackend?.() !== 'basic_text';
        } catch (_) { return false; }
    }

    status(id) {
        return { credentialsConfigured: this.sessions.has(id) || Boolean(this.encrypted[id]), sessionOnly: this.sessions.has(id) };
    }

    async get(id) {
        if (this.sessions.has(id)) return { ...this.sessions.get(id) };
        if (!this.encrypted[id]) return {};
        try {
            if (!this.canPersist()) throw new Error('Protected storage unavailable');
            return validateSecrets(JSON.parse(this.safeStorage.decryptString(Buffer.from(this.encrypted[id], 'base64'))));
        } catch (_) { throw Object.assign(new Error('Protected credentials must be entered again'), { code: 'CREDENTIALS_UNAVAILABLE' }); }
    }

    async set(id, input, { sessionOnly = false } = {}) {
        const secrets = validateSecrets(input);
        if (sessionOnly || !this.canPersist()) {
            this.sessions.set(id, secrets);
            // Explicitly replacing saved credentials with a session credential
            // must not resurrect an older password after restarting.
            if (this.encrypted[id]) { delete this.encrypted[id]; await this.persist(); }
            return this.status(id);
        }
        const ciphertext = this.safeStorage.encryptString(JSON.stringify(secrets));
        this.encrypted[id] = ciphertext.toString('base64');
        await this.persist();
        this.sessions.delete(id);
        return this.status(id);
    }

    async delete(id) {
        this.sessions.delete(id);
        delete this.encrypted[id];
        await this.persist();
    }

    persist() {
        const contents = JSON.stringify({ version: 1, entries: this.encrypted });
        const operation = this.tail.then(async () => {
            await fs.mkdir(path.dirname(this.filename), { recursive: true });
            const temporary = `${this.filename}.${randomUUID()}.partial`;
            const handle = await fs.open(temporary, 'wx', 0o600);
            try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
            await fs.rename(temporary, this.filename);
        });
        this.tail = operation.catch(() => {});
        return operation;
    }

    async close() { await this.tail; this.sessions.clear(); }
}

module.exports = { CredentialStore, validateSecrets, SECRET_FIELDS };
