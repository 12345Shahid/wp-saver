/**
 * Post-install patcher for whatsapp-web.js v1.34.7
 * Fixes the WhatsApp Web July 2026 breaking change: id._serialized → id.$1
 * 
 * STRATEGY: Instead of fragile regex on property accesses, we inject a single
 * normalizer shim at the top of Client.js and Utils.js that automatically
 * copies id.$1 → id._serialized on every message object before the library
 * ever touches it. This way we don't need to patch individual reads.
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
 * Patch Utils.js — inject normalizer into getMessageModel
 */
function patchUtils() {
    const filePath = path.join(WWEBJS_ROOT, 'src', 'util', 'Injected', 'Utils.js');
    if (!fs.existsSync(filePath)) {
        console.log('  ⚠️ Utils.js not found at expected path, skipping.');
        return;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes('[PATCH-v2]')) {
        console.log('  ℹ️ Utils.js already patched, skipping.');
        return;
    }

    const marker = 'window.WWebJS.getMessageModel = (message) => {';
    if (!content.includes(marker)) {
        console.log('  ⚠️ Could not find getMessageModel in Utils.js, skipping.');
        return;
    }

    content = content.replace(
        marker,
        `${marker}
        // [PATCH-v2] Normalize WhatsApp Web July 2026 id.$1 → id._serialized
        if (message && message.id) {
            if (!message.id._serialized && message.id.$1) message.id._serialized = message.id.$1;
            if (message.id.remote && typeof message.id.remote === 'object' && !message.id.remote._serialized && message.id.remote.$1) {
                message.id.remote._serialized = message.id.remote.$1;
            }
        }`
    );

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('  ✅ Patched: Utils.js (getMessageModel normalizer)');
    totalPatches++;
}

/**
 * Patch Client.js — inject normalizer into the message collection listener setup
 */
function patchClient() {
    const filePath = path.join(WWEBJS_ROOT, 'src', 'Client.js');
    if (!fs.existsSync(filePath)) {
        console.log('  ⚠️ Client.js not found, skipping.');
        return;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes('[PATCH-v2]')) {
        console.log('  ℹ️ Client.js already patched, skipping.');
        return;
    }

    // Inject a global normalizer right after WAWebCollections is loaded
    const marker = "const { Msg, Chat } = window.require('WAWebCollections');";
    if (!content.includes(marker)) {
        console.log('  ⚠️ Could not find WAWebCollections import in Client.js, skipping.');
        return;
    }

    // Only inject once (first occurrence is enough — it defines a global window helper)
    const patchCode = `
                    // [PATCH-v2] Global ID normalizer for WhatsApp Web July 2026 _serialized→$1 rename
                    if (!window.__patchNormalizeId) {
                        window.__patchNormalizeId = (obj) => {
                            if (!obj) return obj;
                            if (obj.id) {
                                if (!obj.id._serialized && obj.id.$1) obj.id._serialized = obj.id.$1;
                                if (obj.id.remote && typeof obj.id.remote === 'object' && !obj.id.remote._serialized && obj.id.remote.$1) {
                                    obj.id.remote._serialized = obj.id.remote.$1;
                                }
                            }
                            return obj;
                        };
                        // Monkey-patch Msg.get to auto-normalize returned messages
                        if (Msg && Msg.get) {
                            const _origMsgGet = Msg.get.bind(Msg);
                            Msg.get = function(...args) {
                                const result = _origMsgGet(...args);
                                if (result) window.__patchNormalizeId(result);
                                return result;
                            };
                        }
                        // Intercept Msg 'add' to normalize IDs before any library handler sees them
                        if (Msg && Msg.on) {
                            const _origMsgOn = Msg.on.bind(Msg);
                            Msg.on = function(event, handler) {
                                return _origMsgOn(event, function(msg) {
                                    if (msg) window.__patchNormalizeId(msg);
                                    return handler(msg);
                                });
                            };
                        }
                    }`;

    content = content.replace(marker, marker + patchCode);

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('  ✅ Patched: Client.js (global ID normalizer + Msg.get/Msg.on interceptors)');
    totalPatches++;
}

console.log('🔧 Patching whatsapp-web.js for WhatsApp Web July 2026 _serialized → $1 rename...\n');

patchUtils();
patchClient();

console.log(`\n🎉 Patching complete! ${totalPatches} file(s) modified.`);
if (totalPatches === 0) {
    console.log('  ℹ️  No files needed patching (already patched or structure changed).');
}
