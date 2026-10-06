const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { CloudStore } = require('./store');
const { CredentialStore, validateSecrets } = require('./credentials');
const { PersistentQueue, Semaphore, cloudError, classifyError, TERMINAL } = require('./queue');
const { CloudRepository, hashStream, UUID } = require('./repository');
const { validateConfig } = require('./config');
const { validateManifest, snapshotPrefix, gameParts } = require('./format');

const DEFAULT_CACHE_BUDGET = 5 * 1024 ** 3;
const clone = value => JSON.parse(JSON.stringify(value));
const nonterminal = job => !TERMINAL.has(job.stage);
const opaqueVersionId = manifest => createHash('sha256').update([manifest.repositoryId, manifest.publisherDeviceId, manifest.gameKey, manifest.snapshotId].join('/')).digest('hex');
const transportConfig = config => Object.fromEntries(Object.entries(config).filter(([key]) => !['name', 'repositoryId', 'readOnly', 'allowInsecureHttp'].includes(key)));
const credentialReference = target => target.credentialRef || target.id;
const repositoryLocation = config => Object.fromEntries(['type', 'url', 'endpoint', 'bucket', 'prefix', 'repositoryId'].filter(key => config[key] !== undefined).map(key => [key, config[key]]));
const sameLocation = (a, b) => isDeepStrictEqual(repositoryLocation(a), repositoryLocation(b));

function completeCredentials(config, secrets) {
    const keys = config.type === 's3' ? ['accessKeyId', 'secretAccessKey'] : ['username', 'password'];
    return keys.every(key => Object.hasOwn(secrets, key) && typeof secrets[key] === 'string');
}

function frozenMetadata(metadata) {
    const pick = (source, fields) => Object.fromEntries(fields.filter(key => source[key] === null || ['string', 'number', 'boolean'].includes(typeof source[key])).map(key => [key, source[key]]));
    const result = pick(metadata, ['schemaVersion', 'minimumReaderVersion', 'snapshotId', 'sourceSnapshotId', 'originDeviceId', 'deviceId', 'createdAt', 'gameKey', 'title', 'zh_CN', 'backup_size', 'customName', 'custom_name', 'isPermanent', 'is_permanent', 'legacyDate', 'timezoneUncertain', 'platform']);
    result.backup_paths = metadata.backup_paths.map(entry => pick(entry, ['folder_name', 'template', 'originalTemplate', 'type', 'install_folder', 'file_name']));
    if (Array.isArray(metadata.platform)) result.platform = metadata.platform.filter(value => typeof value === 'string').slice(0, 100);
    if (metadata.accountScope) result.accountScope = pick(metadata.accountScope, ['steamId64', 'steamAccountId', 'ubisoftAccountId', 'epicAccountId', 'xboxAccountId', 'rockstarAccountId']);
    if (metadata.customDefinition) {
        result.customDefinition = pick(metadata.customDefinition, ['title', 'wiki_page_id', 'install_folder']);
        result.customDefinition.save_location = {};
        for (const platform of ['win', 'mac', 'linux', 'reg']) if (Array.isArray(metadata.customDefinition.save_location?.[platform])) result.customDefinition.save_location[platform] = metadata.customDefinition.save_location[platform].map(entry => pick(entry, ['template', 'type']));
    }
    return result;
}

async function directorySize(directory) {
    let bytes = 0;
    let count = 0;
    const pending = [directory];
    while (pending.length) {
        const current = pending.pop();
        const stat = await fsp.lstat(current);
        if (stat.isSymbolicLink()) throw cloudError('INVALID_REQUEST');
        if (++count > 1000000) throw cloudError('SPACE_LIMIT');
        if (stat.isDirectory()) {
            for (const name of await fsp.readdir(current)) pending.push(path.join(current, name));
        } else if (stat.isFile()) bytes += stat.size;
        else throw cloudError('INVALID_REQUEST');
        if (!Number.isSafeInteger(bytes)) throw cloudError('SPACE_LIMIT');
    }
    return bytes;
}

class CloudService {
    constructor(options) {
        this.options = options;
        this.root = path.join(options.userDataPath, 'GSM Cloud');
        this.cacheRoot = path.join(this.root, 'cache');
        this.store = options.store || new CloudStore(path.join(this.root, 'cloud.db'));
        this.credentials = options.credentials || new CredentialStore(path.join(this.root, 'credentials.json'), options.safeStorage);
        this.createProvider = options.createProvider || require('./providers').createProvider;
        this.archive = options.archive || require('../archive');
        this.snapshots = options.snapshotStore || require('../snapshotStore');
        this.coordinator = options.coordinator || require('../backupCoordinator');
        this.packaging = new Semaphore(1);
        this.protections = new Map();
        this.providers = new Set();
        this.mutationTail = Promise.resolve();
        this.pendingLibraryOperations = 0;
        this.notices = [];
        this.queue = new PersistentQueue(this.store, (job, context) => this.runJob(job, context), options.queueOptions);
        this.queue.on('change', () => this.notify());
        this.queue.on('settled', job => {
            if (TERMINAL.has(job.stage) || job.cancelRequested) this.finishJob(job).catch(() => {});
        });
    }

    mutate(fn) {
        const operation = this.mutationTail.then(fn);
        this.mutationTail = operation.catch(() => {});
        return operation;
    }

    async trackLibraryOperation(operation, { admit = false } = {}) {
        if (admit && this.coordinator.isLibraryBusy?.()) throw cloudError('ACTIVE_JOBS');
        // Reserve synchronously, before even waiting for the mutation queue.
        // Main's migration guard checks this counter before reserving its
        // exclusive library lock, closing the admission/SQLite commit gap.
        // Do not acquire another library read lock: commit hooks already hold
        // one, and a queued writer would make reentrant acquisition deadlock.
        this.pendingLibraryOperations++;
        try { return await operation(); }
        finally { this.pendingLibraryOperations--; }
    }

    hasUnfinishedJobs() {
        return this.pendingLibraryOperations > 0 || this.queue.active.size > 0 || [...this.queue.jobs.values()].some(nonterminal);
    }

    async initialize() {
        await fsp.mkdir(this.cacheRoot, { recursive: true });
        await this.store.open();
        await this.credentials.open();
        this.device = await this.store.get('settings', 'device') || { id: randomUUID(), name: os.hostname() };
        this.automatic = await this.store.get('settings', 'automatic') || { targetId: null, gameKeys: [] };
        this.cache = await this.store.get('settings', 'cache') || { budgetBytes: DEFAULT_CACHE_BUDGET };
        await this.store.put('settings', 'device', this.device);
        await this.queue.initialize();
        await this.cleanupInterruptedCache();
        for (const job of this.queue.jobs.values()) {
            if (job.kind === 'upload' && nonterminal(job) && !job.archivePath) this.protect(job);
            if (TERMINAL.has(job.stage) || job.cancelRequested) await this.finishJob(job);
        }
        this.coordinator?.setIntentProvider?.(game => this.intentFor(game));
        this.coordinator?.setCommitHook?.(snapshot => this.onLocalCommit(snapshot));
        await this.recoverIntents();
        this.initialized = true;
        this.queue.start();
        return this;
    }

    backupRoot() {
        const root = this.options.getBackupPath?.();
        if (typeof root !== 'string' || !root) throw cloudError('INVALID_CONFIG');
        return root;
    }

    async close() {
        this.closed = true;
        clearTimeout(this.notifyTimer);
        this.coordinator?.setCommitHook?.(null);
        this.coordinator?.setIntentProvider?.(null);
        await this.mutationTail;
        await this.queue.close();
        for (const release of this.protections.values()) release();
        this.protections.clear();
        for (const provider of this.providers) provider.close?.();
        await this.credentials.close();
        await this.store.close();
    }

    notify() {
        if (!this.options.onUpdate || !this.initialized || this.closed || this.notifyTimer) return;
        this.notifyTimer = setTimeout(async () => {
            this.notifyTimer = null;
            try { this.options.onUpdate(await this.getState()); } catch (_) { /* Closing or unavailable storage. */ }
        }, 100);
        this.notifyTimer.unref?.();
    }

    usedBytes() { return [...this.queue.jobs.values()].filter(nonterminal).reduce((total, job) => total + (job.reservationBytes || 0), 0); }

    async reserve(bytes) {
        if (!Number.isSafeInteger(bytes) || bytes < 0 || this.usedBytes() + bytes > this.cache.budgetBytes) throw cloudError('SPACE_LIMIT');
        if (fsp.statfs) {
            const space = await fsp.statfs(this.cacheRoot);
            if (Number(space.bavail) * Number(space.bsize) < bytes + 32 * 1024 ** 2) throw cloudError('ENOSPC');
        }
    }

    publicJob(job) {
        return {
            id: job.id, jobId: job.id, targetId: job.targetId, revision: job.revision, kind: job.kind,
            stage: job.stage, attempts: job.attempts, nextAttemptAt: job.nextAttemptAt,
            gameId: job.gameId, gameKey: job.gameKey, snapshotId: job.snapshotId, title: job.snapshotMetadata?.title || job.manifest?.title,
            createdAt: job.createdAt, updatedAt: job.updatedAt, progress: job.progress || null,
            error: job.error || null, result: job.result || null,
            cleanupPending: Boolean(job.multipart && job.cancelRequested)
        };
    }

    async getState() {
        const records = await this.store.list('targets');
        const targets = records.map(target => ({ ...target.config, id: target.id, revision: target.revision, capabilities: target.capabilities || null, ...this.credentials.status(credentialReference(target)) }));
        const revisions = new Map((await this.store.list('revisions')).map(target => [`${target.id}:${target.revision}`, target]));
        const currentTargets = new Map(records.map(target => [target.id, target]));
        const versions = [];
        for (const version of await this.store.list('versions')) {
            const current = currentTargets.get(version.targetId);
            const original = revisions.get(`${version.targetId}:${version.revision}`);
            if (current && original && sameLocation(current.config, original.config)) versions.push({ ...version.manifest, ...version });
        }
        return { targets, automatic: clone(this.automatic), device: clone(this.device), cache: { ...this.cache, usedBytes: this.usedBytes() }, jobs: [...this.queue.jobs.values()].map(job => this.publicJob(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), versions, notices: this.notices.slice(-20), secureStorageAvailable: this.credentials.canPersist() };
    }

    async target(id, revision) {
        if (!UUID.test(id || '')) throw cloudError('INVALID_REQUEST');
        const target = await this.store.get(revision ? 'revisions' : 'targets', revision ? `${id}:${revision}` : id);
        if (!target) throw cloudError('NOT_FOUND');
        return target;
    }

    saveTarget({ config, secrets, sessionOnly }) {
        return this.mutate(async () => {
            const normalized = validateConfig(config);
            const id = config.id || randomUUID();
            if (!UUID.test(id)) throw cloudError('INVALID_REQUEST');
            const old = config.id ? await this.target(id) : null;
            const sameTransport = old && isDeepStrictEqual(transportConfig(old.config), transportConfig(normalized));
            const credentialRef = sameTransport ? credentialReference(old) : randomUUID();
            const validated = secrets === undefined ? {} : validateSecrets(secrets);
            const credentialStatus = this.credentials.status(credentialRef);
            const retentionChanged = sameTransport && credentialStatus.credentialsConfigured && sessionOnly !== undefined && credentialStatus.sessionOnly !== sessionOnly;
            if (Object.keys(validated).length || retentionChanged) {
                let previous = {};
                if (sameTransport) {
                    try { previous = await this.credentials.get(credentialRef); }
                    catch (error) {
                        // DPAPI-bound ciphertext from another user/machine
                        // must be replaceable, without requiring decryption.
                        if (error.code !== 'CREDENTIALS_UNAVAILABLE' || !completeCredentials(normalized, validated)) throw error;
                    }
                } else if (!completeCredentials(normalized, validated)) throw cloudError('INVALID_CONFIG');
                const retainedSessionOnly = sessionOnly ?? (sameTransport && credentialStatus.sessionOnly);
                await this.credentials.set(credentialRef, { ...previous, ...validated }, { sessionOnly: retainedSessionOnly });
            }
            // A changed host/bucket/prefix/proxy receives an empty new reference
            // unless the user explicitly supplied its complete credentials.
            // Old queued revisions retain the old location's credential ref.
            const keepProbe = sameTransport && (!secrets || !Object.keys(secrets).length);
            const record = { id, revision: (old?.revision || 0) + 1, config: normalized, credentialRef, ...(keepProbe && old.capabilities ? { capabilities: old.capabilities, testedAt: old.testedAt } : {}) };
            const operations = [{ collection: 'targets', id, value: record }, { collection: 'revisions', id: `${id}:${record.revision}`, value: record }];
            if (old && !sameLocation(old.config, normalized)) {
                for (const version of await this.store.list('versions')) if (version.targetId === id) operations.push({ collection: 'versions', id: `${id}:${version.versionId}`, delete: true });
            }
            await this.store.batch(operations);
            this.notify();
            return { ...normalized, id, revision: record.revision, ...this.credentials.status(credentialRef) };
        });
    }

    removeTarget({ targetId }) {
        return this.mutate(async () => {
            const target = await this.target(targetId);
            if ([...this.queue.jobs.values()].some(job => job.targetId === targetId && nonterminal(job))) throw cloudError('ACTIVE_JOBS');
            if (this.automatic.targetId === targetId) {
                this.automatic = { targetId: null, gameKeys: [] };
                await this.store.put('settings', 'automatic', this.automatic);
            }
            const operations = [{ collection: 'targets', id: targetId, delete: true }];
            for (const version of await this.store.list('versions')) if (version.targetId === targetId) operations.push({ collection: 'versions', id: `${targetId}:${version.versionId}`, delete: true });
            await this.store.batch(operations);
            const references = new Set([credentialReference(target), ...(await this.store.list('revisions')).filter(revision => revision.id === targetId).map(credentialReference)]);
            for (const reference of references) await this.credentials.delete(reference);
            this.notify();
            return { removed: true };
        });
    }

    async withRepository(target, fn) {
        const provider = await this.createProvider(target.config, await this.credentials.get(credentialReference(target)), { resolveProxy: this.options.resolveProxy });
        this.providers.add(provider);
        try { return await fn(new CloudRepository(provider, target.config, this.device), provider); }
        finally { this.providers.delete(provider); provider.close?.(); }
    }

    async testConnection({ targetId, config, secrets }) {
        const target = targetId ? await this.target(targetId) : { id: null, config: validateConfig(config) };
        const provider = await this.createProvider(target.config, targetId ? await this.credentials.get(credentialReference(target)) : validateSecrets(secrets || {}), { resolveProxy: this.options.resolveProxy });
        try {
            const report = await provider.probe({ readOnly: target.config.readOnly });
            if (targetId) {
                const checked = { ...target, capabilities: { read: report.readback === null ? report.authentication === true : report.readback === true, write: report.write === true, delete: report.delete === true }, testedAt: new Date().toISOString() };
                await this.mutate(async () => {
                    const latest = await this.target(targetId);
                    if (latest.revision !== target.revision) return;
                    await this.store.batch([{ collection: 'targets', id: targetId, value: checked }, { collection: 'revisions', id: `${targetId}:${target.revision}`, value: checked }]);
                    this.notify();
                });
            }
            return { authentication: report.authentication, list: report.list, write: report.write, readback: report.readback, delete: report.delete, residualKey: typeof report.residualKey === 'string' && /^gsm\/[^?\x00-\x1f]{1,300}$/.test(report.residualKey) ? report.residualKey : null, error: report.error ? classifyError(report.error) : null };
        } finally { provider.close?.(); }
    }

    async discoverRepositories({ targetId }) { return this.withRepository(await this.target(targetId), repository => repository.discover()); }

    async createRepository({ targetId }) {
        const target = await this.target(targetId);
        const repositoryId = randomUUID();
        const modified = { ...target, config: { ...target.config, repositoryId } };
        await this.withRepository(modified, repository => repository.create());
        return this.saveTarget({ config: { ...modified.config, id: targetId } });
    }

    async selectRepository({ targetId, repositoryId }) {
        if (!UUID.test(repositoryId || '')) throw cloudError('INVALID_REQUEST');
        const target = await this.target(targetId);
        const repositories = await this.withRepository(target, repository => repository.discover());
        if (!repositories.some(repository => repository.id === repositoryId)) throw cloudError('NOT_FOUND');
        return this.saveTarget({ config: { ...target.config, id: targetId, repositoryId } });
    }

    setAutomatic({ targetId, gameKeys = [] }) {
        return this.mutate(async () => {
            if (!Array.isArray(gameKeys) || gameKeys.length > 10000) throw cloudError('INVALID_REQUEST');
            gameKeys.forEach(gameParts);
            if (targetId !== null) {
                const target = await this.target(targetId);
                if (target.config.readOnly) throw cloudError('READ_ONLY');
                if (!target.config.repositoryId) throw cloudError('INVALID_CONFIG');
            }
            this.automatic = { targetId, gameKeys: [...new Set(gameKeys)] };
            await this.store.put('settings', 'automatic', this.automatic);
            this.notify();
            return clone(this.automatic);
        });
    }

    setCacheBudget({ bytes }) {
        return this.mutate(async () => {
            if (!Number.isSafeInteger(bytes) || bytes < 64 * 1024 ** 2 || bytes > 1024 ** 5 || bytes < this.usedBytes()) throw cloudError('SPACE_LIMIT');
            this.cache = { budgetBytes: bytes };
            await this.store.put('settings', 'cache', this.cache);
            this.notify();
            return { ...this.cache, usedBytes: this.usedBytes() };
        });
    }

    setDevice({ name }) {
        return this.mutate(async () => {
            if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw cloudError('INVALID_REQUEST');
            this.device = { id: this.device.id, name: name.trim() };
            await this.store.put('settings', 'device', this.device);
            this.notify();
            return clone(this.device);
        });
    }

    async intentFor(game) {
        if (!this.automatic.targetId || (this.automatic.gameKeys.length && !this.automatic.gameKeys.includes(game.gameKey))) return null;
        const target = await this.target(this.automatic.targetId);
        if (target.config.readOnly || !target.config.repositoryId) return null;
        return { jobId: randomUUID(), targetId: target.id, revision: target.revision, repositoryId: target.config.repositoryId, deviceId: this.device.id, state: 'pending' };
    }

    async onLocalCommit(snapshot) {
        const intent = snapshot.metadata?.cloudUploadIntent;
        if (!intent || intent.state === 'completed') return;
        return this.trackLibraryOperation(async () => {
            try { return await this.mutate(() => this.enqueueSnapshot(snapshot, intent.targetId, { revision: intent.revision, automatic: true, jobId: intent.jobId })); }
            catch (error) {
                this.notices.push({ snapshotId: snapshot.snapshotId, gameId: snapshot.gameId, error: classifyError(error), localBackupSucceeded: true, cloudQueued: false });
                // Commit hooks already hold the library read lock. Include
                // rejection cleanup in admission tracking without reacquiring it.
                await this.completeIntent(snapshot, classifyError(error).code);
                this.notify();
            }
        });
    }

    async recoverIntents() {
        let snapshots;
        try { snapshots = await this.snapshots.listSnapshots(this.backupRoot()); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        for (const snapshot of snapshots) if (snapshot.metadata?.cloudUploadIntent && snapshot.metadata.cloudUploadIntent.state !== 'completed') await this.onLocalCommit(snapshot);
    }

    async completeIntent(snapshot, errorCode) {
        try {
            const fresh = await this.snapshots.readSnapshot(snapshot.root || this.backupRoot(), snapshot.gameId, snapshot.folder);
            if (!fresh.metadata.cloudUploadIntent) return;
            if (this.snapshots.markUploadIntentCompleted) return this.snapshots.markUploadIntentCompleted(fresh, errorCode);
            const metadata = { ...fresh.metadata, cloudUploadIntent: { ...fresh.metadata.cloudUploadIntent, state: 'completed', ...(errorCode ? { errorCode } : {}) } };
            if (!this.snapshots.atomicWriteJson) throw cloudError('INVALID_CONFIG');
            await this.snapshots.atomicWriteJson(path.join(fresh.path, 'backup_info.json'), metadata);
        } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'NOT_FOUND') throw error; }
    }

    publicSnapshot(snapshot) {
        return { gameId: snapshot.gameId, gameKey: snapshot.gameKey, title: snapshot.metadata.title, folder: snapshot.folder, snapshotId: snapshot.snapshotId, createdAt: snapshot.createdAt, customName: snapshot.metadata.customName || snapshot.metadata.custom_name || '', isPermanent: Boolean(snapshot.metadata.isPermanent || snapshot.metadata.is_permanent), backupSize: snapshot.metadata.backup_size || 0 };
    }

    async listLocalSnapshots({ gameId } = {}) { return (await this.snapshots.listSnapshots(this.backupRoot(), gameId)).map(snapshot => this.publicSnapshot(snapshot)); }

    async selectedSnapshots({ selection = 'latest', gameIds } = {}) {
        if (!['latest', 'permanent', 'all'].includes(selection) || (gameIds && (!Array.isArray(gameIds) || gameIds.length > 10000))) throw cloudError('INVALID_REQUEST');
        const snapshots = await this.snapshots.listSnapshots(this.backupRoot());
        const seen = new Set();
        return snapshots.filter(snapshot => {
            if (gameIds && !gameIds.map(String).includes(String(snapshot.gameId))) return false;
            if (selection === 'permanent') return snapshot.metadata.isPermanent || snapshot.metadata.is_permanent;
            if (selection === 'all') return true;
            if (seen.has(snapshot.gameId)) return false;
            seen.add(snapshot.gameId);
            return true;
        });
    }

    async previewUpload(input) {
        const target = await this.target(input.targetId);
        if (target.config.readOnly) throw cloudError('READ_ONLY');
        const snapshots = await this.selectedSnapshots(input);
        let totalBytes = 0;
        for (const snapshot of snapshots) totalBytes += await directorySize(snapshot.path);
        return { count: snapshots.length, totalBytes, snapshots: snapshots.map(snapshot => this.publicSnapshot(snapshot)) };
    }

    upload({ targetId, gameId, folder }) {
        return this.trackLibraryOperation(() => this.mutate(async () => this.publicJob(await this.enqueueSnapshot(await this.snapshots.readSnapshot(this.backupRoot(), gameId, folder), targetId))), { admit: true });
    }

    uploadMany(input) {
        return this.trackLibraryOperation(() => this.mutate(async () => {
            const snapshots = await this.selectedSnapshots(input);
            const jobs = [];
            const rejected = [];
            for (const snapshot of snapshots) {
                try { jobs.push(this.publicJob(await this.enqueueSnapshot(snapshot, input.targetId))); }
                catch (error) { rejected.push({ snapshotId: snapshot.snapshotId, gameId: snapshot.gameId, error: classifyError(error) }); }
            }
            return { jobs, rejected };
        }), { admit: true });
    }

    protect(job) {
        if (!this.protections.has(job.id) && job.sourcePath) this.protections.set(job.id, this.coordinator.protectSnapshot(job.sourcePath));
    }

    enqueueSnapshot(snapshot, targetId, options = {}) {
        return this.trackLibraryOperation(() => this.enqueueSnapshotAccepted(snapshot, targetId, options), { admit: true });
    }

    async enqueueSnapshotAccepted(snapshot, targetId, { revision, automatic = false, jobId } = {}) {
        if (this.coordinator.isLibraryBusy?.()) throw cloudError('ACTIVE_JOBS');
        if (jobId && this.queue.jobs.has(jobId)) return this.queue.jobs.get(jobId);
        const target = await this.target(targetId, revision);
        if (target.config.readOnly) throw cloudError('READ_ONLY');
        if (!target.config.repositoryId) throw cloudError('INVALID_CONFIG');
        if (snapshot.metadata.restoreProtection || snapshot.metadata.backup_paths.some(entry => entry.originalMissing)) throw cloudError('INVALID_REQUEST');
        snapshot = await this.snapshots.ensureIdentity(snapshot, this.device.id);
        const duplicate = [...this.queue.jobs.values()].find(job => job.kind === 'upload' && job.targetId === targetId && job.revision === target.revision && job.snapshotId === snapshot.snapshotId && nonterminal(job));
        if (duplicate) return duplicate;
        const id = jobId || randomUUID();
        const job = { id, targetId, revision: target.revision, kind: 'upload', automatic, gameId: snapshot.gameId, gameKey: snapshot.gameKey, folder: snapshot.folder, sourceRoot: snapshot.root || this.backupRoot(), sourcePath: snapshot.path, snapshotId: snapshot.snapshotId, localSnapshotId: snapshot.snapshotId, snapshotMetadata: frozenMetadata(snapshot.metadata), repositoryId: target.config.repositoryId };
        this.protect(job);
        try {
            if (this.coordinator.isLibraryBusy?.()) throw cloudError('ACTIVE_JOBS');
            const sourceBytes = await directorySize(snapshot.path);
            job.reservationBytes = sourceBytes * 3 + 1024 ** 2;
            await this.reserve(job.reservationBytes);
            return await this.queue.add(job);
        } catch (error) { this.protections.get(id)?.(); this.protections.delete(id); throw error; }
    }

    async refresh({ targetId }) {
        const target = await this.target(targetId);
        const listing = await this.withRepository(target, repository => repository.browse());
        return this.mutate(async () => {
            if ((await this.target(targetId)).revision !== target.revision) throw cloudError('NOT_FOUND');
            const refreshedAt = new Date().toISOString();
            const versions = listing.manifests.map(manifest => ({ versionId: opaqueVersionId(manifest), targetId, revision: target.revision, manifest, deviceName: listing.deviceNames?.[manifest.publisherDeviceId] || null, refreshedAt, stale: false }));
            const present = new Set(versions.map(version => version.versionId));
            const operations = versions.map(version => ({ collection: 'versions', id: `${targetId}:${version.versionId}`, value: version }));
            // An empty/eventually-consistent list never deletes cached history.
            for (const previous of await this.store.list('versions')) if (previous.targetId === targetId && !present.has(previous.versionId)) operations.push({ collection: 'versions', id: `${targetId}:${previous.versionId}`, value: { ...previous, stale: true } });
            await this.store.batch(operations);
            this.notify();
            return { versions: versions.map(version => ({ ...version.manifest, ...version })), refreshedAt, invalidCount: listing.invalidCount };
        });
    }

    cacheVersion(job, manifest) {
        return this.mutate(async () => {
            const current = await this.store.get('targets', job.targetId);
            const original = await this.target(job.targetId, job.revision);
            if (!current || !sameLocation(current.config, original.config)) return;
            const versionId = opaqueVersionId(manifest);
            await this.store.put('versions', `${job.targetId}:${versionId}`, { versionId, targetId: job.targetId, revision: job.revision, manifest, refreshedAt: new Date().toISOString(), stale: false });
        });
    }

    async version(targetId, versionId, revision) {
        if (!/^[a-f0-9]{64}$/.test(versionId || '')) throw cloudError('INVALID_REQUEST');
        const version = await this.store.get('versions', `${targetId}:${versionId}`);
        if (!version || version.targetId !== targetId) throw cloudError('NOT_FOUND');
        const current = await this.target(targetId);
        const original = await this.target(targetId, version.revision);
        if (!sameLocation(current.config, original.config)) throw cloudError('NOT_FOUND');
        if (revision !== undefined && !sameLocation(current.config, (await this.target(targetId, revision)).config)) throw cloudError('NOT_FOUND');
        validateManifest(version.manifest);
        return version;
    }

    download(input) { return this.enqueueVersion(input, 'download'); }
    restore(input) { return this.enqueueVersion(input, 'restore'); }

    enqueueVersion({ targetId, versionId, revision }, kind) {
        return this.trackLibraryOperation(() => this.mutate(async () => {
            const version = await this.version(targetId, versionId, revision);
            const target = await this.target(targetId);
            const duplicate = [...this.queue.jobs.values()].find(job => job.kind === kind && job.targetId === targetId && job.versionId === versionId && nonterminal(job));
            if (duplicate) return this.publicJob(duplicate);
            const reservationBytes = version.manifest.archiveSize + version.manifest.unpackedSize * 2 + 1024 ** 2;
            await this.reserve(reservationBytes);
            const [type, gameId] = gameParts(version.manifest.gameKey);
            return this.publicJob(await this.queue.add({ id: randomUUID(), targetId, revision: target.revision, kind, versionId, manifest: version.manifest, snapshotId: version.manifest.snapshotId, gameId, gameKey: version.manifest.gameKey, reservationBytes }));
        }), { admit: true });
    }

    deleteVersion({ targetId, versionId, revision, confirmPermanent = false }) {
        return this.mutate(async () => {
            const version = await this.version(targetId, versionId, revision);
            const target = await this.target(targetId);
            if (target.config.readOnly) throw cloudError('READ_ONLY');
            if (target.capabilities?.delete === false) throw cloudError('ACCESS_DENIED');
            if (version.manifest.isPermanent && !confirmPermanent) throw cloudError('INVALID_REQUEST');
            if ([...this.queue.jobs.values()].some(job => job.targetId === targetId && job.snapshotId === version.manifest.snapshotId && nonterminal(job))) throw cloudError('ACTIVE_JOBS');
            return this.publicJob(await this.queue.add({ id: randomUUID(), targetId, revision: target.revision, kind: 'delete', versionId, manifest: version.manifest, snapshotId: version.manifest.snapshotId, reservationBytes: 0 }));
        });
    }

    controlJob({ jobId, action }) {
        return this.trackLibraryOperation(async () => {
            const result = await this.queue.control(jobId, action);
            if (result.stage === 'cancelled' || result.cancelRequested) await this.finishJob(result);
            return this.publicJob(result);
        });
    }

    sourceUploadJobs(snapshotPath) {
        const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
        return [...this.queue.jobs.values()].filter(job => job.kind === 'upload' && nonterminal(job) &&
            job.sourcePath && canonical(job.sourcePath) === canonical(snapshotPath));
    }

    async cancelSourceUploads(snapshotPath) {
        for (const job of this.sourceUploadJobs(snapshotPath)) await this.controlJob({ jobId: job.id, action: 'cancel' });
    }

    cachePath(id, suffix = '.gsmr') {
        if (!UUID.test(id)) throw cloudError('INVALID_REQUEST');
        return path.join(this.cacheRoot, `${id}${suffix}`);
    }

    async removeCache(filename, recursive = false) {
        const resolved = path.resolve(filename);
        if (!resolved.startsWith(path.resolve(this.cacheRoot) + path.sep)) throw cloudError('INVALID_REQUEST');
        await fsp.rm(resolved, { recursive, force: true });
    }

    async cleanupInterruptedCache() {
        // Only unpublished, application-generated temporary names are eligible.
        // Accepted .gsmr archives remain intact even when their queue is paused.
        for (const entry of await fsp.readdir(this.cacheRoot, { withFileTypes: true })) {
            if (entry.isDirectory() && /^\.package-[A-Za-z0-9_-]+$/.test(entry.name)) await this.removeCache(path.join(this.cacheRoot, entry.name), true);
            else if (entry.isFile() && (/^[a-f0-9-]{36}\.files\.txt$/i.test(entry.name) || /^[a-f0-9-]{36}\.gsmr(?:\.[a-f0-9-]{36})?\.partial$/i.test(entry.name))) await this.removeCache(path.join(this.cacheRoot, entry.name));
        }
    }

    finishJob(job) {
        return this.trackLibraryOperation(async () => {
            if (job.kind === 'upload') {
                try { await this.completeIntent({ root: job.sourceRoot, gameId: job.gameId, folder: job.folder }, job.cancelRequested || job.stage === 'cancelled' ? 'CANCELLED' : undefined); } catch (_) { /* Recoverable on next library scan. */ }
                this.protections.get(job.id)?.();
                this.protections.delete(job.id);
            }
            await this.removeCache(this.cachePath(job.id)).catch(() => {});
            await this.removeCache(this.cachePath(job.id, '.gsmr.partial')).catch(() => {});
            await this.removeCache(this.cachePath(job.id, '.extract'), true).catch(() => {});
        });
    }

    async runJob(job, context) {
        const target = await this.target(job.targetId, job.revision);
        return this.withRepository(target, async (repository, provider) => {
            if (job.multipart && provider.abortMultipart) {
                await provider.abortMultipart(job.multipart.key, job.multipart.uploadId, { signal: context.signal });
                await context.update({ multipart: null });
            }
            if (job.cleanupOnly) {
                if (job.multipart && !provider.abortMultipart) throw cloudError('INVALID_CONFIG');
                return null;
            }
            if (job.kind === 'upload') return this.runUpload(job, repository, context);
            if (job.kind === 'download' || job.kind === 'restore') return this.runDownload(job, repository, context);
            if (job.kind === 'delete') {
                const result = await repository.delete(job.manifest, context);
                await this.mutate(async () => {
                    const cached = await this.store.get('versions', `${job.targetId}:${job.versionId}`);
                    const cachedTarget = cached && await this.target(job.targetId, cached.revision);
                    if (cachedTarget && sameLocation(cachedTarget.config, target.config)) await this.store.delete('versions', `${job.targetId}:${job.versionId}`);
                });
                return result;
            }
            throw cloudError('INVALID_REQUEST');
        });
    }

    async runUpload(job, repository, context) {
        let current = job;
        const output = this.cachePath(job.id);
        const originalPrefix = snapshotPrefix(repository.config.repositoryId, this.device.id, current.gameKey, current.snapshotId);
        if (await repository.isDeleted(originalPrefix, context.signal)) {
            if (current.automatic) throw cloudError('SNAPSHOT_DELETED');
            const wasProtected = this.protections.has(current.id);
            this.protect(current);
            try {
                // A cached task previously released its source reservation. A
                // new cloud identity requires metadata repackaging, so reserve
                // that working space again before invalidating the old cache.
                const sourceBytes = await directorySize(current.sourcePath);
                const reservationBytes = sourceBytes * 3 + 1024 ** 2 + (current.manifest?.archiveSize || 0);
                await this.reserve(Math.max(0, reservationBytes - current.reservationBytes));
                const snapshotId = randomUUID();
                current = await context.update({ snapshotId, archivePath: null, manifest: null, reservationBytes,
                    snapshotMetadata: { ...current.snapshotMetadata, sourceSnapshotId: current.localSnapshotId || current.snapshotId, snapshotId } });
            } catch (error) {
                if (!wasProtected) { this.protections.get(current.id)?.(); this.protections.delete(current.id); }
                throw error;
            }
        }
        {
            const prefix = snapshotPrefix(repository.config.repositoryId, this.device.id, current.gameKey, current.snapshotId);
            if (await repository.provider.stat(`${prefix}/manifest.json`, { signal: context.signal })) {
                const existing = await repository.readManifest(`${prefix}/manifest.json`, context.signal);
                if (!isDeepStrictEqual(existing.snapshotMetadata, current.snapshotMetadata)) throw cloudError('CONFLICT');
                if (current.manifest) {
                    if (current.manifest.archiveSha256 !== existing.archiveSha256 || current.manifest.contentHash !== existing.contentHash) throw cloudError('CONFLICT');
                } else {
                    const snapshot = await this.snapshots.readSnapshot(current.sourceRoot, current.gameId, current.folder);
                    if (await this.snapshots.computeContentHash(snapshot.path, current.snapshotMetadata) !== existing.contentHash) throw cloudError('CONFLICT');
                }
                await context.update({ stage: 'verifying' });
                await repository.verifyPayload(existing, { signal: context.signal });
                const versionId = opaqueVersionId(existing);
                await this.cacheVersion(job, existing);
                return { versionId, snapshotId: existing.snapshotId, alreadyCommitted: true };
            }
        }
        if (current.archivePath && current.manifest) {
            try {
                const digest = await hashStream(fs.createReadStream(output), { expectedSize: current.manifest.archiveSize, signal: context.signal });
                if (digest.size !== current.manifest.archiveSize || digest.sha256 !== current.manifest.archiveSha256) throw cloudError('INTEGRITY_ERROR');
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                current = await context.update({ archivePath: null, manifest: null });
                this.protect(current);
            }
        }
        if (!current.archivePath) {
            await this.packaging.use(async () => {
                await context.update({ stage: 'packaging', progress: null });
                const snapshot = await this.snapshots.readSnapshot(current.sourceRoot, current.gameId, current.folder);
                if (snapshot.snapshotId !== (current.localSnapshotId || current.snapshotId)) throw cloudError('CONFLICT');
                const result = await this.archive.createSnapshotArchive(snapshot, output, { signal: context.signal, metadata: current.snapshotMetadata });
                const newUsed = this.usedBytes() - current.reservationBytes + result.archiveSize;
                if (newUsed > this.cache.budgetBytes) { await this.removeCache(output); throw cloudError('SPACE_LIMIT'); }
                const metadata = result.metadata || current.snapshotMetadata;
                const manifest = {
                    schemaVersion: 1, minimumReaderVersion: 1, repositoryId: repository.config.repositoryId,
                    snapshotId: current.snapshotId, originDeviceId: metadata.originDeviceId || metadata.deviceId || this.device.id, publisherDeviceId: this.device.id,
                    gameKey: current.gameKey, title: metadata.title || current.gameKey, zh_CN: metadata.zh_CN || null,
                    platform: metadata.platform || null, accountScope: metadata.accountScope || null,
                    createdAt: metadata.createdAt, uploadedAt: new Date().toISOString(),
                    archiveSha256: result.archiveSha256, archiveSize: result.archiveSize, contentHash: result.contentHash,
                    unpackedSize: result.unpackedSize, fileCount: result.fileCount,
                    backup_paths: metadata.backup_paths, customName: metadata.customName || metadata.custom_name || '',
                    isPermanent: Boolean(metadata.isPermanent || metadata.is_permanent), snapshotMetadata: metadata,
                    ...(metadata.sourceSnapshotId ? { sourceSnapshotId: metadata.sourceSnapshotId } : {}),
                    ...(metadata.customDefinition ? { customDefinition: metadata.customDefinition } : {}),
                    ...(metadata.legacyDate ? { legacyDate: metadata.legacyDate, timezoneUncertain: true } : {})
                };
                manifest.archiveKey = `${snapshotPrefix(manifest.repositoryId, manifest.publisherDeviceId, manifest.gameKey, manifest.snapshotId)}/payload-${manifest.archiveSha256}.gsmr`;
                validateManifest(manifest);
                current = await context.update({ archivePath: output, manifest, reservationBytes: result.archiveSize });
                await this.completeIntent(snapshot);
                this.protections.get(job.id)?.();
                this.protections.delete(job.id);
            }, context.signal);
        }
        if (current.automatic && !current.manifest.isPermanent) {
            const reference = (await this.store.list('versions')).filter(version => version.targetId === current.targetId && version.revision === current.revision && version.manifest.publisherDeviceId === this.device.id && version.manifest.gameKey === current.gameKey && JSON.stringify(version.manifest.accountScope) === JSON.stringify(current.manifest.accountScope)).sort((a, b) => b.manifest.uploadedAt.localeCompare(a.manifest.uploadedAt))[0];
            if (reference?.manifest.contentHash === current.manifest.contentHash) {
                const prefix = repository.prefix(reference.manifest);
                if (!await repository.isDeleted(prefix, context.signal) && await repository.provider.stat(`${prefix}/manifest.json`, { signal: context.signal })) {
                    const remote = await repository.readManifest(`${prefix}/manifest.json`, context.signal);
                    if (remote.contentHash === current.manifest.contentHash) {
                        await context.update({ stage: 'verifying' });
                        await repository.verifyPayload(remote, { signal: context.signal });
                        return { versionId: reference.versionId, snapshotId: remote.snapshotId, duplicateContent: true };
                    }
                }
            }
        }
        const manifest = await repository.publish(current.manifest, output, context);
        const versionId = opaqueVersionId(manifest);
        await this.cacheVersion(job, manifest);
        return { versionId, snapshotId: manifest.snapshotId };
    }

    async runDownload(job, repository, context) {
        const output = this.cachePath(job.id);
        if (job.kind === 'restore' && job.result?.folder && job.restoreConfirmed) return this.performRestore(job, job.result, context);
        const manifest = await repository.download(job.manifest, output, context);
        await context.update({ stage: 'verifying', progress: null });
        const extraction = this.cachePath(job.id, '.extract');
        await this.removeCache(extraction, true);
        let extracted;
        try { extracted = await this.archive.extractSnapshotArchive(output, extraction, manifest, { signal: context.signal }); }
        catch (error) {
            if (context.signal.aborted || error.code === 'ENOSPC') throw error;
            throw cloudError('INTEGRITY_ERROR');
        }
        await context.update({ stage: 'importing' });
        const metadata = { ...extracted.metadata, cloudSource: { targetId: job.targetId, repositoryId: manifest.repositoryId, publisherDeviceId: manifest.publisherDeviceId, originDeviceId: manifest.originDeviceId }, contentHash: manifest.contentHash };
        delete metadata.cloudUploadIntent;
        const imported = await this.snapshots.importSnapshot(this.backupRoot(), extracted.path || extraction, { ...metadata, gameId: job.gameId, gameKey: manifest.gameKey });
        if (imported.conflict) throw cloudError('CONFLICT');
        const result = { snapshotId: imported.snapshot.snapshotId, gameId: imported.snapshot.gameId, folder: imported.snapshot.folder, duplicate: Boolean(imported.duplicate) };
        if (job.kind === 'restore') {
            await context.update({ result });
            await this.removeCache(extraction, true);
            return this.performRestore(job, result, context);
        }
        await this.removeCache(extraction, true);
        return result;
    }

    async performRestore(job, result, context) {
        if (!this.options.restoreSnapshot) throw cloudError('PATH_MAPPING_REQUIRED');
        await context.update({ stage: 'restoring' });
        const restored = await this.options.restoreSnapshot({ gameId: result.gameId, folder: result.folder, mappings: job.restoreMappings || {}, confirmRegistry: job.confirmRegistry === true });
        const expectedFolders = new Set(job.manifest.backup_paths.map(entry => entry.folder_name));
        const pathResults = (Array.isArray(restored?.pathResults) ? restored.pathResults : []).filter(entry => expectedFolders.has(entry?.folder) && typeof entry.success === 'boolean').map(entry => {
            if (entry.success) return { folder: entry.folder, success: true };
            // Local exceptions can include absolute paths, commands or URLs.
            // Expose only a known classification and its fixed public message.
            let error = classifyError({ code: entry.code || entry.error?.code });
            if (error.code === 'CLOUD_ERROR') error = classifyError(cloudError('RESTORE_FAILED'));
            return { folder: entry.folder, success: false, error: { code: error.code, message: error.message } };
        });
        const protectionFolder = typeof restored?.protectionFolder === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,239}$/.test(restored.protectionFolder) ? restored.protectionFolder : null;
        const safeResult = { ...result, pathResults, protectionFolder, protectionSnapshotId: UUID.test(restored?.protectionSnapshotId || '') ? restored.protectionSnapshotId : null };
        if (!restored || restored.error || pathResults.some(entry => !entry.success)) {
            await context.update({ result: { ...safeResult, restored: false, mappingsRequired: restored?.mappingsRequired || [], registryTargets: restored?.registryTargets || [], restoreMappings: job.restoreMappings || {} } });
            throw cloudError(['PATH_MAPPING_REQUIRED', 'REGISTRY_CONFIRMATION_REQUIRED'].includes(restored?.code) ? restored.code : 'RESTORE_FAILED');
        }
        const registration = restored.customGameRegistration;
        let customGameRegistration;
        if (['registered', 'existing'].includes(registration?.status)) customGameRegistration = { status: registration.status };
        else if (registration?.status === 'failed') customGameRegistration = {
            status: 'failed', code: ['CUSTOM_ENTRIES_CORRUPT', 'CUSTOM_GAME_INVALID', 'CUSTOM_GAME_REGISTRATION_FAILED'].includes(registration.code) ? registration.code : 'CUSTOM_GAME_REGISTRATION_FAILED'
        };
        return { ...safeResult, mappingsRequired: [], registryTargets: [], restored: true, ...(customGameRegistration ? { customGameRegistration } : {}) };
    }

    async chooseRestoreMapping({ jobId, folder }) {
        const job = this.queue.jobs.get(jobId);
        if (!job || job.kind !== 'restore' || job.stage !== 'failed' || !this.options.chooseRestoreMapping) throw cloudError('INVALID_REQUEST');
        const requirement = job.result?.mappingsRequired?.find(entry => entry.folder === folder);
        if (!requirement || requirement.type === 'reg') throw cloudError('INVALID_REQUEST');
        const chosen = await this.options.chooseRestoreMapping(requirement);
        if (!chosen) return this.publicJob(job);
        if (typeof chosen !== 'string' || !path.isAbsolute(chosen)) throw cloudError('INVALID_REQUEST');
        const restoreMappings = { ...job.restoreMappings, [folder]: chosen };
        const changed = await this.queue.update(jobId, { restoreMappings, result: { ...job.result, restoreMappings } });
        return this.publicJob(changed);
    }

    confirmRestore({ jobId, confirmRegistry = false }) {
        return this.trackLibraryOperation(async () => {
            const job = this.queue.jobs.get(jobId);
            if (!job || job.kind !== 'restore' || job.stage !== 'failed' || !['PATH_MAPPING_REQUIRED', 'REGISTRY_CONFIRMATION_REQUIRED'].includes(job.error?.code)) throw cloudError('INVALID_REQUEST');
            if ((job.result?.mappingsRequired || []).some(entry => !job.restoreMappings?.[entry.folder])) throw cloudError('PATH_MAPPING_REQUIRED');
            await this.queue.update(jobId, { restoreConfirmed: true, confirmRegistry: confirmRegistry === true });
            return this.publicJob(await this.queue.control(jobId, 'retry'));
        }, { admit: true });
    }
}

async function createCloudService(options) {
    const service = new CloudService(options);
    try { return await service.initialize(); }
    catch (error) { await service.close().catch(() => {}); throw error; }
}

module.exports = { CloudService, createCloudService, DEFAULT_CACHE_BUDGET, directorySize, frozenMetadata, opaqueVersionId };
