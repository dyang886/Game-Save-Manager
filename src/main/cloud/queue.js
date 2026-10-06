const { EventEmitter } = require('node:events');

const TERMINAL = new Set(['succeeded', 'cancelled']);
const INTERRUPTED = new Set(['packaging', 'uploading', 'verifying', 'committing', 'downloading', 'importing', 'deleting', 'restoring']);
const MESSAGES = {
    INVALID_CONFIG: '云连接配置无效。', NOT_FOUND: '指定的云备份或本地版本不存在。',
    AUTHENTICATION_FAILED: '云存储认证失败，请检查凭据。', ACCESS_DENIED: '云存储权限不足。',
    CREDENTIALS_UNAVAILABLE: '安全凭据不可用，请重新输入凭据。', READ_ONLY: '此连接只允许读取。',
    INTEGRITY_ERROR: '备份完整性校验失败，操作已停止。', UNSUPPORTED_FORMAT: '云仓库格式较新，请升级应用。',
    SPACE_LIMIT: '云备份缓存额度不足，请增大额度或处理现有任务。', ENOSPC: '本地磁盘空间不足。',
    PATH_MAPPING_REQUIRED: '该版本需要确认本机存档路径映射；已保留下载的本地副本。',
    REGISTRY_CONFIRMATION_REQUIRED: '恢复此版本会修改列出的注册表键，需要明确确认。',
    RESTORE_FAILED: '恢复未能全部完成，请检查本地恢复结果与保护备份。',
    SNAPSHOT_DELETED: '该云版本已被明确删除，不能使用原版本身份重新上传。',
    CONFLICT: '版本身份冲突，现有内容已保留。', ACTIVE_JOBS: '请先取消或完成此连接的任务。',
    INVALID_REQUEST: '云备份请求无效。', UNTRUSTED_SENDER: '拒绝来自非可信窗口的请求。',
    NETWORK_ERROR: '云存储暂时不可达，稍后重试。', CERTIFICATE_ERROR: '无法验证服务器证书。',
    REDIRECT_REFUSED: '云存储返回了不安全、过多或不支持的跳转，请检查服务地址。',
    QUOTA_EXCEEDED: '云存储容量或配额不足。', CANCELLED: '任务已取消。', CLOUD_ERROR: '云备份操作失败，请检查连接配置和存储权限。',
    LISTING_LIMIT: '云存储目录返回数量达到服务限制，无法确认列表完整；请缩小目录范围后重试。'
};

function cloudError(code) { return Object.assign(new Error(MESSAGES[code] || MESSAGES.CLOUD_ERROR), { code }); }

function classifyError(error) {
    const status = Number(error?.statusCode || error?.status || error?.$metadata?.httpStatusCode || error?.response?.status);
    let code = error?.code;
    if (status === 401 || ['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'ExpiredToken', 'InvalidToken'].includes(error?.name)) code = 'AUTHENTICATION_FAILED';
    else if (status === 403 || error?.name === 'AccessDenied') code = 'ACCESS_DENIED';
    else if (status === 404 || error?.name === 'NoSuchKey') code = 'NOT_FOUND';
    else if (status === 507 || ['QuotaExceeded', 'StorageLimitExceeded'].includes(error?.name)) code = 'QUOTA_EXCEEDED';
    else if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code || '')) code = 'CERTIFICATE_ERROR';
    else if (code === 'SQLITE_FULL') code = 'ENOSPC';
    else if (['AbortError', 'CanceledError'].includes(error?.name)) code = 'CANCELLED';
    const retryable = status === 408 || status === 429 || (status >= 500 && status <= 599 && status !== 507) || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'NETWORK_ERROR'].includes(code) || error?.retryable === true;
    if (retryable) code = 'NETWORK_ERROR';
    if (!MESSAGES[code]) code = 'CLOUD_ERROR';
    // No provider message, signed URL, header or cause escapes this boundary.
    return { code, message: MESSAGES[code], retryable, ...(status ? { status } : {}) };
}

class Semaphore {
    constructor(limit) { this.limit = limit; this.count = 0; this.waiters = []; }
    async use(fn, signal) {
        if (signal?.aborted) throw cloudError('CANCELLED');
        if (this.count >= this.limit) await new Promise((resolve, reject) => {
            const entry = { resolve, reject };
            const abort = () => { this.waiters = this.waiters.filter(item => item !== entry); reject(cloudError('CANCELLED')); };
            entry.resolve = () => { signal?.removeEventListener('abort', abort); resolve(); };
            signal?.addEventListener('abort', abort, { once: true });
            this.waiters.push(entry);
        });
        else this.count++;
        try {
            if (signal?.aborted) throw cloudError('CANCELLED');
            return await fn();
        } finally {
            const next = this.waiters.shift();
            if (next) next.resolve();
            else this.count--;
        }
    }
}

class PersistentQueue extends EventEmitter {
    constructor(store, handler, { concurrency = 2, maxAttempts = 6, random = Math.random, retryBaseMs = 2000 } = {}) {
        super();
        this.store = store;
        this.handler = handler;
        this.concurrency = concurrency;
        this.maxAttempts = maxAttempts;
        this.random = random;
        this.retryBaseMs = retryBaseMs;
        this.jobs = new Map();
        this.active = new Map();
        this.stopping = true;
        this.controls = new Map();
        this.updateTails = new Map();
    }

    async initialize() {
        for (const job of await this.store.list('jobs')) {
            if ((job.cancelRequested && job.stage !== 'succeeded') || (job.stage === 'cancelled' && job.multipart)) {
                job.cancelRequested = true;
                job.cleanupOnly = true;
                job.stage = job.multipart ? 'pending' : 'cancelled';
                job.reservationBytes = 0;
                await this.store.put('jobs', job.id, job);
            } else if (job.stage === 'restoring') {
                // Restoring changes live game data. A crash may have happened
                // after any path write, so only a new user action can resume it.
                job.stage = 'failed';
                job.error = classifyError(cloudError('RESTORE_FAILED'));
                job.recovered = true;
                await this.store.put('jobs', job.id, job);
            } else if (INTERRUPTED.has(job.stage)) {
                job.stage = 'pending';
                job.recovered = true;
                await this.store.put('jobs', job.id, job);
            }
            this.jobs.set(job.id, job);
        }
    }

    start() { this.stopping = false; this.schedule(); }

    async add(job) {
        const saved = { ...job, jobId: job.id, attempts: 0, stage: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await this.store.put('jobs', saved.id, saved);
        this.jobs.set(saved.id, saved);
        this.emit('change', saved);
        this.schedule();
        return saved;
    }

    async update(id, values) {
        const operation = (this.updateTails.get(id) || Promise.resolve()).then(async () => {
            const current = this.jobs.get(id);
            if (!current) throw cloudError('NOT_FOUND');
            const job = { ...current, ...values, updatedAt: new Date().toISOString() };
            await this.store.put('jobs', id, job);
            this.jobs.set(id, job);
            this.emit('change', job);
            return job;
        });
        this.updateTails.set(id, operation.catch(() => {}));
        return operation;
    }

    schedule(delay = 0) {
        if (this.stopping) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.drain(), delay);
        this.timer.unref?.();
    }

    drain() {
        if (this.stopping) return;
        for (const job of this.jobs.values()) {
            if (this.active.size >= this.concurrency) break;
            if (this.active.has(job.id) || !['pending', 'retry_wait'].includes(job.stage) || (job.nextAttemptAt || 0) > Date.now()) continue;
            const controller = new AbortController();
            const promise = this.execute(job.id, controller);
            this.active.set(job.id, { controller, promise });
            promise.catch(error => {
                // If the database itself fails, its last durable phase is the
                // restart checkpoint. Stop dispatching instead of losing jobs
                // through an unhandled rejection or an endless write loop.
                this.stopping = true;
                clearTimeout(this.timer);
                const failed = { ...this.jobs.get(job.id), stage: 'failed', error: classifyError(error) };
                this.jobs.set(job.id, failed);
                this.emit('change', failed);
            });
        }
        const deadlines = [...this.jobs.values()].filter(job => job.stage === 'retry_wait' && !this.active.has(job.id)).map(job => Math.max(25, (job.nextAttemptAt || 0) - Date.now()));
        if (deadlines.length) this.schedule(Math.min(...deadlines));
    }

    async execute(id, controller) {
        try {
            const job = await this.update(id, { attempts: this.jobs.get(id).attempts + 1, error: null, nextAttemptAt: 0 });
            const update = async values => {
                if (controller.signal.aborted) throw cloudError('CANCELLED');
                return this.update(id, values);
            };
            const reportProgress = progress => {
                if (controller.signal.aborted) return;
                const current = this.jobs.get(id);
                this.jobs.set(id, { ...current, progress });
                this.emit('change', this.jobs.get(id));
            };
            // Persist externally created upload IDs even if cancellation arrived
            // while the provider was creating/aborting a multipart upload.
            const checkpointMultipart = multipart => this.update(id, { multipart });
            const result = await this.handler(job, { signal: controller.signal, update, reportProgress, checkpointMultipart });
            // An irreversible commit/import that finished just before cancellation
            // must remain visible as success; cancellation never undoes it.
            await this.update(id, { stage: job.cleanupOnly ? 'cancelled' : 'succeeded', cancelRequested: Boolean(job.cleanupOnly), result: result || null, error: null, reservationBytes: 0, progress: null });
        } catch (error) {
            const control = this.controls.get(id);
            if (control || this.stopping) await this.update(id, { stage: control === 'cancelled' && this.jobs.get(id).multipart ? 'pending' : control || 'pending', error: null, ...(control === 'cancelled' ? { reservationBytes: 0, cleanupOnly: true, attempts: 0 } : {}) });
            else {
                const safe = classifyError(error);
                const job = this.jobs.get(id);
                const retry = safe.retryable && job.attempts < this.maxAttempts;
                const retryAfter = error?.retryAfter || error?.response?.headers?.['retry-after'];
                const seconds = Number(retryAfter);
                const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
                const delay = Math.min(300000, this.retryBaseMs * 2 ** Math.min(job.attempts - 1, 8)) * (0.75 + this.random() * 0.5);
                await this.update(id, { stage: retry ? 'retry_wait' : 'failed', error: safe, nextAttemptAt: retry ? Date.now() + Math.max(delay, retryAfterMs) : 0 });
            }
        } finally {
            this.active.delete(id);
            this.controls.delete(id);
            this.emit('settled', this.jobs.get(id));
            this.schedule();
        }
    }

    async control(id, action) {
        const job = this.jobs.get(id);
        if (!job) throw cloudError('NOT_FOUND');
        if (!['pause', 'resume', 'cancel', 'retry'].includes(action)) throw cloudError('INVALID_REQUEST');
        if (job.stage === 'restoring' && this.active.has(id)) throw cloudError('ACTIVE_JOBS');
        if (TERMINAL.has(job.stage)) return job;
        const stage = { pause: 'paused', resume: 'pending', retry: 'pending', cancel: 'cancelled' }[action];
        if (this.active.has(id)) {
            if (action === 'resume' || action === 'retry') throw cloudError('ACTIVE_JOBS');
            const operation = this.active.get(id);
            // The worker may fail while SQLite persists the cancellation intent.
            // Let its catch path observe the requested control during that write.
            this.controls.set(id, stage);
            if (action === 'cancel') await this.update(id, { cancelRequested: true });
            if (!this.active.has(id)) return this.jobs.get(id);
            operation.controller.abort();
            await operation.promise;
        } else await this.update(id, { stage: action === 'cancel' && job.multipart ? 'pending' : stage, error: null, nextAttemptAt: 0, ...(action === 'retry' || action === 'cancel' ? { attempts: 0 } : {}), ...(action === 'cancel' ? { reservationBytes: 0, cancelRequested: true, cleanupOnly: true } : {}) });
        this.schedule();
        return this.jobs.get(id);
    }

    async close() {
        this.stopping = true;
        clearTimeout(this.timer);
        const operations = [...this.active.values()];
        for (const operation of operations) operation.controller.abort();
        await Promise.allSettled(operations.map(operation => operation.promise));
    }
}

module.exports = { PersistentQueue, Semaphore, classifyError, cloudError, TERMINAL };
