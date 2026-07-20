/**
 * Post-install patcher for whatsapp-web.js v1.34.7
 * Fixes the WhatsApp Web July 2026 breaking change: id._serialized → id.$1
 * 
 * Run after npm install: node scripts/patch-serialized.js
 */

const fs = require('fs');
const path = require('path');

const WWEBJS_ROOT = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');

if (!fs.existsSync(WWEBJS_ROOT)) {
    console.error('❌ whatsapp-web.js not found in node_modules. Run npm install first.');
    process.exit(1);
}

let totalPatches = 0;

/**
 * Recursively find all .js files under a directory
 */
function getAllJsFiles(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
            results = results.concat(getAllJsFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * Patch a single file: inject a $1 → _serialized normalizer into the
 * WWebJS.getMessageModel function, and add fallbacks wherever ._serialized
 * is accessed on id objects.
 */
function patchFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf-8');
    const original = content;

    // 1. In Utils.js — patch getMessageModel to normalize id.$1 → id._serialized
    //    before the rest of the function runs
    if (filePath.includes('Injected/Utils.js') || filePath.includes('Injected\\Utils.js')) {
        // Inject normalizer at the top of getMessageModel
        const getModelMarker = 'window.WWebJS.getMessageModel = (message) => {';
        if (content.includes(getModelMarker)) {
            content = content.replace(
                getModelMarker,
                `${getModelMarker}
        // [PATCH] Normalize WhatsApp Web July 2026 id.$1 → id._serialized
        if (message && message.id && !message.id._serialized && message.id.$1) {
            message.id._serialized = message.id.$1;
        }
        if (message && message.id && message.id.remote && typeof message.id.remote === 'object' && !message.id.remote._serialized && message.id.remote.$1) {
            message.id.remote._serialized = message.id.remote.$1;
        }`
            );
        }

        // Also patch the serialize method reference if it exists
        // The msg.id.remote._serialized access in the serialized output
        const remoteSerializedPattern = "msg.id.remote._serialized";
        if (content.includes(remoteSerializedPattern)) {
            content = content.replace(
                /msg\.id\.remote\._serialized/g,
                '(msg.id.remote._serialized || msg.id.remote.$1 || msg.id.remote)'
            );
        }
    }

    // 2. In Client.js — patch message event handlers to normalize IDs
    if (filePath.includes('Client.js')) {
        // Add normalizer helper at the top of the evaluate blocks
        // Patch the main message collection listener setup
        const collectionMarker = "const { Msg, Chat } = window.require('WAWebCollections');";
        if (content.includes(collectionMarker)) {
            content = content.replace(
                collectionMarker,
                `${collectionMarker}
                    // [PATCH] Normalize WhatsApp Web July 2026 id.$1 → id._serialized
                    const __normalizeId = (obj) => {
                        if (obj && obj.id && !obj.id._serialized && obj.id.$1) {
                            obj.id._serialized = obj.id.$1;
                        }
                        if (obj && obj.id && obj.id.remote && typeof obj.id.remote === 'object' && !obj.id.remote._serialized && obj.id.remote.$1) {
                            obj.id.remote._serialized = obj.id.remote.$1;
                        }
                        return obj;
                    };`
            );
        }

        // Patch every onAddMessageEvent call to normalize first
        content = content.replace(
            /window\.onAddMessageEvent\(\s*window\.WWebJS\.getMessageModel\((\w+)\)/g,
            'window.onAddMessageEvent(window.WWebJS.getMessageModel(__normalizeId ? __normalizeId($1) : $1)'
        );

        // Patch every onChangeMessageEvent call
        content = content.replace(
            /window\.onChangeMessageEvent\(\s*window\.WWebJS\.getMessageModel\((\w+)\)/g,
            'window.onChangeMessageEvent(window.WWebJS.getMessageModel(__normalizeId ? __normalizeId($1) : $1)'
        );

        // Patch direct _serialized accesses with fallback
        content = content.replace(
            /(\w+)\.id\._serialized(?!\s*\|\|)/g,
            '($1.id._serialized || $1.id.$1)'
        );
    }

    // 3. In Message structures — patch _serialized references with fallback
    if (filePath.includes('structures/Message.js') || filePath.includes('structures\\Message.js')) {
        content = content.replace(
            /this\.id\._serialized(?!\s*\|\|)/g,
            '(this.id._serialized || this.id.$1)'
        );
        content = content.replace(
            /msg\.id\._serialized(?!\s*\|\|)/g,
            '(msg.id._serialized || msg.id.$1)'
        );
    }

    // 4. Generic fallback: In any remaining file, patch standalone .id._serialized accesses
    //    (Be careful not to double-patch)
    if (!filePath.includes('Client.js') && !filePath.includes('Message.js')) {
        // Only patch simple property accesses that aren't already patched
        content = content.replace(
            /(\w+)\.id\._serialized(?!\s*\|\|)/g,
            '($1.id._serialized || $1.id.$1)'
        );
    }

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf-8');
        const relPath = path.relative(WWEBJS_ROOT, filePath);
        console.log(`  ✅ Patched: ${relPath}`);
        totalPatches++;
    }
}

console.log('🔧 Patching whatsapp-web.js for WhatsApp Web July 2026 _serialized → $1 rename...\n');

const srcDir = path.join(WWEBJS_ROOT, 'src');
if (!fs.existsSync(srcDir)) {
    console.error('❌ whatsapp-web.js/src directory not found. Library structure may have changed.');
    process.exit(1);
}

const jsFiles = getAllJsFiles(srcDir);
console.log(`  📁 Found ${jsFiles.length} source files to scan.\n`);

for (const file of jsFiles) {
    patchFile(file);
}

console.log(`\n🎉 Patching complete! ${totalPatches} file(s) modified.`);
if (totalPatches === 0) {
    console.log('  ℹ️  No files needed patching (already patched or structure changed).');
}
