/**
 * Post-install patcher for whatsapp-web.js v1.34.7
 * Fixes the WhatsApp Web July 2026 breaking change: id._serialized → id.$1
 * 
 * STRATEGY (v3 Complete Defense):
 * 1. Utils.js: Injects `deepNormalizeId` to recursively restore `_serialized` from `$1`
 *    on any object (`msg`, `chat`, `contact`) inside and after `message.serialize()`.
 * 2. Client.js: Wraps `onAddMessageEvent` and `Msg.on` so every message passed from
 *    the browser to Puppeteer IPC is completely normalized.
 * 3. Structures (Message.js, Chat.js, Contact.js): Adds `$1` fallbacks to `data.from`,
 *    `data.to`, `data.author`, `data.id`, ensuring Node.js classes never get `undefined`.
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
 * 1. Patch Utils.js — inject deepNormalizeId and apply to getMessageModel / getChatModel / getContactModel
 */
function patchUtils() {
    const filePath = path.join(WWEBJS_ROOT, 'src', 'util', 'Injected', 'Utils.js');
    if (!fs.existsSync(filePath)) {
        console.log('  ⚠️ Utils.js not found at expected path, skipping.');
        return;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes('[PATCH-v3]')) {
        console.log('  ℹ️ Utils.js already patched (v3), skipping.');
        return;
    }

    const marker = 'window.WWebJS.getMessageModel = (message) => {';
    if (!content.includes(marker)) {
        console.log('  ⚠️ Could not find getMessageModel in Utils.js, skipping.');
        return;
    }

    // Define deepNormalizeId helper at top of WWebJS helpers
    const normalizerDef = `
    // [PATCH-v3] Deep ID Normalizer for WhatsApp Web July 2026 ($1 -> _serialized)
    window.WWebJS.deepNormalizeId = (obj, seen = new WeakSet()) => {
        if (!obj || typeof obj !== 'object' || seen.has(obj)) return obj;
        seen.add(obj);
        if (obj.$1 && typeof obj.$1 === 'string' && !obj._serialized) {
            obj._serialized = obj.$1;
        }
        if (obj.id && typeof obj.id === 'object') {
            if (obj.id.$1 && typeof obj.id.$1 === 'string' && !obj.id._serialized) {
                obj.id._serialized = obj.id.$1;
            }
            if (obj.id.remote && typeof obj.id.remote === 'object' && obj.id.remote.$1 && !obj.id.remote._serialized) {
                obj.id.remote._serialized = obj.id.remote.$1;
            }
        }
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (val && typeof val === 'object' && !seen.has(val)) {
                window.WWebJS.deepNormalizeId(val, seen);
            }
        }
        return obj;
    };\n\n    `;

    content = normalizerDef + content;

    // Inside getMessageModel: normalize message before serialize, normalize msg right after serialize, and fix remote._serialized
    content = content.replace(
        'const msg = message.serialize();',
        `window.WWebJS.deepNormalizeId(message);\n        const msg = window.WWebJS.deepNormalizeId(message.serialize());`
    );

    content = content.replace(
        'remote: msg.id.remote._serialized,',
        'remote: (msg.id.remote._serialized || msg.id.remote.$1 || msg.id.remote),'
    );

    // Normalize right before returning from getMessageModel
    content = content.replace(
        'return msg;\n    };',
        'return window.WWebJS.deepNormalizeId(msg);\n    };'
    );

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('  ✅ Patched: Utils.js (deepNormalizeId injected & applied to getMessageModel)');
    totalPatches++;
}

/**
 * 2. Patch Client.js — ensure onAddMessageEvent across Puppeteer receives deep-normalized objects
 */
function patchClient() {
    const filePath = path.join(WWEBJS_ROOT, 'src', 'Client.js');
    if (!fs.existsSync(filePath)) {
        console.log('  ⚠️ Client.js not found, skipping.');
        return;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes('[PATCH-v3]')) {
        console.log('  ℹ️ Client.js already patched (v3), skipping.');
        return;
    }

    const marker = "const { Msg, Chat } = window.require('WAWebCollections');";
    if (!content.includes(marker)) {
        console.log('  ⚠️ Could not find WAWebCollections import in Client.js, skipping.');
        return;
    }

    const patchCode = `
                    // [PATCH-v3] Ensure all messages leaving WAWebCollections to Node.js are deep normalized
                    if (window.WWebJS && !window.__patchV3Active) {
                        window.__patchV3Active = true;
                        const norm = window.WWebJS.deepNormalizeId || ((x) => x);
                        if (Msg && Msg.on) {
                            const _origMsgOn = Msg.on.bind(Msg);
                            Msg.on = function(event, handler) {
                                return _origMsgOn(event, function(msg) {
                                    if (msg) norm(msg);
                                    return handler(msg);
                                });
                            };
                        }
                        // Wrap onAddMessageEvent
                        if (window.onAddMessageEvent) {
                            const _origAdd = window.onAddMessageEvent;
                            window.onAddMessageEvent = (model) => _origAdd(norm(model));
                        }
                        if (window.onChangeMessageEvent) {
                            const _origChange = window.onChangeMessageEvent;
                            window.onChangeMessageEvent = (model) => _origChange(norm(model));
                        }
                    }`;

    content = content.replace(marker, marker + patchCode);

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('  ✅ Patched: Client.js (Puppeteer event boundary deep normalizer)');
    totalPatches++;
}

/**
 * 3. Patch structures (Message.js, Chat.js, Contact.js) — fallback for data.from, data.to, data.author, data.id
 */
function patchStructures() {
    const structDir = path.join(WWEBJS_ROOT, 'src', 'structures');
    if (!fs.existsSync(structDir)) return;

    // Message.js
    const msgFile = path.join(structDir, 'Message.js');
    if (fs.existsSync(msgFile)) {
        let content = fs.readFileSync(msgFile, 'utf-8');
        if (!content.includes('[PATCH-v3]')) {
            content = content.replace(
                'super(client);',
                'super(client);\n        // [PATCH-v3] Ensure data normalization inside constructor'
            );
            content = content.replace(
                '? data.from._serialized',
                '? (data.from._serialized || data.from.$1)'
            );
            content = content.replace(
                '? data.to._serialized',
                '? (data.to._serialized || data.to.$1)'
            );
            content = content.replace(
                '? data.author._serialized',
                '? (data.author._serialized || data.author.$1)'
            );
            content = content.replace(
                /this\.id\._serialized(?!\s*\|\|)/g,
                '(this.id._serialized || this.id.$1)'
            );
            fs.writeFileSync(msgFile, content, 'utf-8');
            console.log('  ✅ Patched: structures/Message.js ($1 fallbacks for from, to, author, id)');
            totalPatches++;
        }
    }

    // Chat.js
    const chatFile = path.join(structDir, 'Chat.js');
    if (fs.existsSync(chatFile)) {
        let content = fs.readFileSync(chatFile, 'utf-8');
        if (!content.includes('[PATCH-v3]')) {
            content = content.replace(
                'super(client);',
                'super(client);\n        // [PATCH-v3]'
            );
            content = content.replace(
                /this\.id\._serialized(?!\s*\|\|)/g,
                '(this.id._serialized || this.id.$1)'
            );
            fs.writeFileSync(chatFile, content, 'utf-8');
            console.log('  ✅ Patched: structures/Chat.js ($1 fallbacks for id)');
            totalPatches++;
        }
    }

    // Contact.js
    const contactFile = path.join(structDir, 'Contact.js');
    if (fs.existsSync(contactFile)) {
        let content = fs.readFileSync(contactFile, 'utf-8');
        if (!content.includes('[PATCH-v3]')) {
            content = content.replace(
                'super(client);',
                'super(client);\n        // [PATCH-v3]'
            );
            content = content.replace(
                /this\.id\._serialized(?!\s*\|\|)/g,
                '(this.id._serialized || this.id.$1)'
            );
            fs.writeFileSync(contactFile, content, 'utf-8');
            console.log('  ✅ Patched: structures/Contact.js ($1 fallbacks for id)');
            totalPatches++;
        }
    }
}

console.log('🔧 Patching whatsapp-web.js for WhatsApp Web July 2026 _serialized → $1 rename (v3 Defense)...\n');

patchUtils();
patchClient();
patchStructures();

console.log(`\n🎉 Patching complete! ${totalPatches} file(s) modified.`);
if (totalPatches === 0) {
    console.log('  ℹ️  No files needed patching (already patched or structure changed).');
}
