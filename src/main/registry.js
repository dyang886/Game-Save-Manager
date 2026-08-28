const nativeReg = require('native-reg');


// ======================================================================
// Key access
// ======================================================================
// Every registry read goes through here, calling Win32 directly rather than spawning reg.exe
const HIVES = {
    HKEY_CLASSES_ROOT: nativeReg.HKEY.CLASSES_ROOT,
    HKEY_CURRENT_USER: nativeReg.HKEY.CURRENT_USER,
    HKEY_LOCAL_MACHINE: nativeReg.HKEY.LOCAL_MACHINE,
    HKEY_USERS: nativeReg.HKEY.USERS,
    HKEY_CURRENT_CONFIG: nativeReg.HKEY.CURRENT_CONFIG,
};

// Splits a path into hive and key; a trailing separator would become part of the name
function parseRegistryPath(registryPath) {
    const segments = registryPath.replace(/[\\/]+$/, '').split('\\');
    return { hive: HIVES[segments.shift().toUpperCase()], subKey: segments.join('\\') };
}

// Open handles must be closed, so every caller here goes through this one wrapper.
function withKey(registryPath, read, fallback) {
    const { hive, subKey } = parseRegistryPath(registryPath);
    if (!hive) return fallback;

    let handle = null;
    try {
        handle = nativeReg.openKey(hive, subKey, nativeReg.Access.READ);
        return handle ? read(handle) : fallback;
    } catch (error) {
        console.error(`Error reading registry key ${registryPath}: ${error.message}`);
        return fallback;
    } finally {
        if (handle) nativeReg.closeKey(handle);
    }
}

function registryKeyExists(registryPath) {
    return withKey(registryPath, () => true, false);
}

// Sorted, because callers pick the first match and enumeration order is not guaranteed.
function getRegistryChildNames(registryPath) {
    return withKey(registryPath, handle =>
        nativeReg.enumKeyNames(handle).sort((a, b) => a.localeCompare(b)), []);
}

// The value as a string, or '' when the key, the value, or the whole read is unavailable.
function getRegistryValue(registryPath, valueName) {
    return withKey(registryPath, handle => {
        const value = nativeReg.queryValue(handle, valueName);
        return value === null || value === undefined ? '' : String(value);
    }, '');
}


// ======================================================================
// Export size
// ======================================================================
// A .reg file is UTF-16LE in a fixed format, so its size follows from a walk of the key
const VALUE_SZ = 1, VALUE_BINARY = 3, VALUE_DWORD = 4;
const HEADER_CHARS = 1 + 'Windows Registry Editor Version 5.00\r\n'.length + 2;  // BOM, header, blank line

const escapeRegText = (text) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// reg.exe fills line one to column 79, then 25 bytes per continuation, each byte "xx,"
function hexValueChars(prefixChars, byteCount) {
    if (byteCount === 0) return prefixChars + 2;

    const firstCapacity = Math.max(1, Math.floor((79 - prefixChars) / 3));
    if (byteCount <= firstCapacity) return prefixChars + 3 * byteCount - 1 + 2;

    let chars = prefixChars + 3 * firstCapacity + 1 + 2;
    let remaining = byteCount - firstCapacity;
    while (remaining > 25) {
        chars += 2 + 75 + 1 + 2;
        remaining -= 25;
    }
    return chars + 2 + 3 * remaining - 1 + 2;
}

function valueChars(name, value) {
    const label = name === '' ? '@' : `"${escapeRegText(name)}"`;

    if (value.type === VALUE_SZ) {
        return label.length + 1 + 1 + escapeRegText(value.toString('ucs2').replace(/\0+$/, '')).length + 1 + 2;
    }
    // Only a four-byte DWORD gets the dword: form; anything else falls back to hex
    if (value.type === VALUE_DWORD && value.length === 4) {
        return label.length + 1 + 'dword:'.length + 8 + 2;
    }
    const tag = value.type === VALUE_BINARY ? 'hex:' : `hex(${value.type.toString(16)}):`;
    return hexValueChars(label.length + 1 + tag.length, value.length);
}

// A key the user cannot read is skipped rather than fatal: one unreadable subkey must
// not cost the game its whole registry save, which reporting nothing here would.
function subtreeChars(handle, displayPath) {
    let chars = 1 + displayPath.length + 1 + 2 + 2;  // [path] line, then a blank line

    try {
        for (const name of nativeReg.enumValueNames(handle)) {
            const value = nativeReg.queryValueRaw(handle, name);
            if (value) chars += valueChars(name, value);
        }
    } catch (error) {
        console.error(`Skipped unreadable values under ${displayPath}: ${error.message}`);
    }

    let childNames = [];
    try {
        childNames = nativeReg.enumKeyNames(handle);
    } catch (error) {
        console.error(`Skipped unreadable subkeys of ${displayPath}: ${error.message}`);
    }

    for (const childName of childNames) {
        let child = null;
        try {
            child = nativeReg.openKey(handle, childName, nativeReg.Access.READ);
        } catch {
            continue;
        }
        if (!child) continue;

        try {
            chars += subtreeChars(child, `${displayPath}\\${childName}`);
        } finally {
            nativeReg.closeKey(child);
        }
    }

    return chars;
}

// Bytes a reg export of this key would produce, or null when the key does not exist.
function getRegistryExportSize(registryPath) {
    const displayPath = registryPath.replace(/[\\/]+$/, '');
    const chars = withKey(registryPath, handle => HEADER_CHARS + subtreeChars(handle, displayPath), null);
    return chars === null ? null : chars * 2;
}

module.exports = {
    registryKeyExists,
    getRegistryChildNames,
    getRegistryValue,
    getRegistryExportSize,
};
