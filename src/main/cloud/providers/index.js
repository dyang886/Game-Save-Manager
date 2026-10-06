const { validateConfig } = require('../config');
const { createWebDAV } = require('./webdav');
const { createS3 } = require('./s3');
async function createProvider(config, secrets, options) {
    const checked = validateConfig(config);
    return checked.type === 'webdav' ? createWebDAV(checked, secrets, options) : createS3(checked, secrets, options);
}
module.exports = { createProvider };
