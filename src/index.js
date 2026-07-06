/**
 * WHATSAPP AUTO-SAVER (LEVEL 1)
 * Captures all incoming messages and media in real-time, archiving them to Supabase
 * PostgreSQL & Storage to bypass "Delete for Everyone" removals.
 */

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('./logger');
const supabase = require('./supabase');
const express = require('express');
const qrcodeImage = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
let currentQrDataUrl = null;
let isAuthenticated = false;

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp Auto-Saver Status</title>
    <meta http-equiv="refresh" content="3">
    <style>
        body { background: #0f172a; color: #f8fafc; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
        .card { background: #1e293b; padding: 32px; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); max-width: 420px; width: 100%; border: 1px solid #334155; }
        h1 { font-size: 20px; margin-top: 0; color: #38bdf8; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
        .qr-box { background: white; padding: 16px; border-radius: 12px; display: inline-block; margin: 20px 0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); }
        .qr-box img { width: 220px; height: 220px; display: block; }
        .badge { display: inline-block; padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
        .waiting { background: #451a03; color: #fbbf24; border: 1px solid #78350f; }
        .online { background: #064e3b; color: #34d399; border: 1px solid #065f46; }
        .footer { font-size: 12px; color: #64748b; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🤖 WhatsApp Auto-Saver</h1>
        ${isAuthenticated ? `
            <div class="badge online">● ONLINE & CONNECTED</div>
            <p style="color: #cbd5e1; font-weight: 500;">Your WhatsApp account is linked! Listening for incoming and deleted messages 24/7.</p>
        ` : currentQrDataUrl ? `
            <div class="badge waiting">● WAITING FOR SCAN</div>
            <p>Open WhatsApp on your phone → Settings → Linked Devices → <b>Link a Device</b> and scan below:</p>
            <div class="qr-box">
                <img src="${currentQrDataUrl}" alt="QR Code" />
            </div>
            <p style="font-size: 12px; color: #64748b;">Page auto-refreshes every 3s. Guaranteed 220x220 compact size!</p>
        ` : `
            <div class="badge waiting">● STARTING BROWSER...</div>
            <p>Chromium is starting in the cloud container. Please wait ~20 seconds for the QR code to appear...</p>
        `}
        <div class="footer">WhatsApp Auto-Saver & Deletion Bypass (Level 1)</div>
    </div>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🌐 Web Dashboard online! Visit http://localhost:${PORT} or your cloud domain URL to view the QR scanner.`);
});

// Show start banner
logger.banner();

// Initialize target filter if specified in .env
const targetFilter = process.env.TARGET_FILTER ? process.env.TARGET_FILTER.trim().toLowerCase() : null;
if (targetFilter) {
    logger.info(`🎯 TARGET FILTER ACTIVE: Only capturing messages matching "${targetFilter}"`);
} else {
    logger.info(`🌐 NO FILTER SET: Capturing messages from ALL incoming chats.`);
}

/**
 * Dynamically locate valid Chromium/Chrome binary across Nixpacks, Docker, Linux, and Mac
 */
function getBrowserExecutablePath() {
    const fs = require('fs');
    const { execSync } = require('child_process');

    // 1. Check user-defined path from env ONLY if the file actually exists
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    // 2. Search common Linux / Nixpacks binary names in system PATH
    const binaryNames = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];
    for (const name of binaryNames) {
        try {
            const foundPath = execSync(`which ${name} 2>/dev/null`).toString().trim();
            if (foundPath && fs.existsSync(foundPath)) {
                return foundPath;
            }
        } catch (e) {}
    }

    // 3. Check common hardcoded standard paths
    const standardPaths = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/snap/bin/chromium'
    ];
    for (const p of standardPaths) {
        if (fs.existsSync(p)) return p;
    }

    // 4. Return undefined to let Puppeteer use its bundled browser
    return undefined;
}

const detectedBrowser = getBrowserExecutablePath();
if (detectedBrowser) {
    logger.info(`🌐 Found system browser binary at: ${detectedBrowser}`);
} else {
    logger.info(`🌐 No system browser found in standard paths, letting Puppeteer use its bundled browser...`);
}

// Initialize WhatsApp Client with LocalAuth for session persistence
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'whatsapp-auto-saver-session'
    }),
    puppeteer: {
        headless: true,
        executablePath: detectedBrowser,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu',
            '--single-process',
            '--no-zygote',
            '--disable-extensions'
        ]
    }
});

/**
 * Event: QR Code generated
 * Scan this with your phone in WhatsApp -> Linked Devices -> Link a device
 */
client.on('qr', async (qr) => {
    try {
        currentQrDataUrl = await qrcodeImage.toDataURL(qr, { width: 300, margin: 1 });
    } catch (e) {}
    isAuthenticated = false;
    logger.qr('====================================================================');
    logger.qr('🌐 WEB DASHBOARD ACTIVE! Open http://localhost:3000 or your domain URL');
    logger.qr('in a browser tab to view a clean, styled 220x220 QR scanner box!');
    logger.qr('====================================================================');
    logger.qr('🔗 ALTERNATIVE IMAGE URL (IF NOT USING WEB DASHBOARD):');
    const qrImageUrl = `https://quickchart.io/qr?size=220&margin=1&text=${encodeURIComponent(qr)}`;
    console.log(`\n${qrImageUrl}\n`);
    logger.info('Waiting for QR code scan from your phone...');
});

/**
 * Event: Client Authenticated
 */
client.on('authenticated', () => {
    isAuthenticated = true;
    currentQrDataUrl = null;
    logger.success('Authentication successful! Session credentials saved locally.');
});

/**
 * Event: Authentication Failure
 */
client.on('auth_failure', (msg) => {
    isAuthenticated = false;
    logger.error('Authentication failed!', msg);
});

/**
 * Event: Client is Ready and Connected
 */
client.on('ready', async () => {
    isAuthenticated = true;
    currentQrDataUrl = null;
    logger.success('🤖 WHATSAPP AUTO-SAVER IS ONLINE AND CONNECTED!');
    logger.info('Listening for incoming text messages, voice notes, images, and deletions...');
    
    // Test Supabase connection
    await supabase.testConnection();
});

/**
 * Core function to handle and save messages
 */
async function handleMessage(msg, isRescued = false) {
    try {
        const contact = await msg.getContact().catch(() => ({}));
        const chat = await msg.getChat().catch(() => ({}));

        const senderPhone = contact.number || contact.id?.user || msg.from || '';
        const senderName = contact.pushname || contact.name || senderPhone || 'Unknown';
        const chatName = chat.name || senderName;

        // Apply Target Filter if configured
        if (targetFilter && !isRescued) {
            const filterDigits = targetFilter.replace(/\D/g, '');
            const senderDigits = senderPhone.replace(/\D/g, '');
            const fromDigits = msg.from.replace(/\D/g, '');

            const matchPhone = filterDigits && (senderDigits.includes(filterDigits) || fromDigits.includes(filterDigits));
            const matchName = senderName.toLowerCase().includes(targetFilter);
            const matchChat = chatName.toLowerCase().includes(targetFilter);
            const matchFrom = msg.from.toLowerCase().includes(targetFilter);

            if (!matchPhone && !matchName && !matchChat && !matchFrom) {
                logger.info(`⏭️ [FILTERED] Ignored message from "${senderName}" (${senderPhone}) - did not match filter "${targetFilter}"`);
                return;
            }
        }

        const timestamp = new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString();
        const messageId = msg.id?._serialized || msg.id?.id || `msg_${Date.now()}`;
        const messageType = msg.type || 'chat';
        let textContent = msg.body || '';
        let mediaUrl = null;
        let mediaType = null;

        logger.info(`📬 Incoming [${messageType.toUpperCase()}] from "${senderName}" (${senderPhone}) in "${chatName}"`);

        // Handle Media Download & Upload (Level 1: Voice Notes / Images / Videos)
        if (msg.hasMedia || ['ptt', 'audio', 'image', 'video', 'document', 'sticker'].includes(messageType)) {
            logger.media(`Media [${messageType}] detected! Downloading file directly into computer memory...`);
            try {
                let media = await msg.downloadMedia();
                
                // Retry up to 3 times if media isn't ready immediately (very common for PTT / voice notes!)
                let retries = 0;
                while (!media && retries < 3) {
                    retries++;
                    logger.media(`Media [${messageType}] stream not ready yet, retrying download (${retries}/3)...`);
                    await new Promise(res => setTimeout(res, 1500));
                    media = await msg.downloadMedia();
                }

                if (media && media.data) {
                    mediaType = media.mimetype;
                    const sizeInMb = (media.data.length * 0.75) / (1024 * 1024);
                    const limitMb = parseFloat(process.env.MEDIA_DOWNLOAD_LIMIT_MB) || 25;

                    if (sizeInMb > limitMb) {
                        logger.warn(`Media file size (~${sizeInMb.toFixed(2)} MB) exceeds limit of ${limitMb} MB. Skipping upload.`);
                    } else {
                        const buffer = Buffer.from(media.data, 'base64');
                        let ext = 'bin';
                        if (mediaType && mediaType.includes('image/jpeg')) ext = 'jpg';
                        else if (mediaType && mediaType.includes('image/png')) ext = 'png';
                        else if ((mediaType && (mediaType.includes('audio') || mediaType.includes('ogg') || mediaType.includes('ptt'))) || messageType === 'ptt' || messageType === 'audio') ext = 'ogg';
                        else if (mediaType && mediaType.includes('video/mp4')) ext = 'mp4';
                        else if (mediaType && mediaType.includes('pdf')) ext = 'pdf';
                        
                        const filename = media.filename || `voice_${msg.timestamp || Date.now()}.${ext}`;
                        mediaUrl = await supabase.uploadMedia(buffer, filename, mediaType || 'audio/ogg');
                    }
                } else {
                    logger.warn(`Could not download media data for message [${messageType}]. It may have expired or failed decryption.`);
                }
            } catch (mediaErr) {
                logger.error('Failed to download/upload media:', mediaErr.message);
            }
        }

        const messageRecord = {
            message_id: messageId,
            timestamp: timestamp,
            sender_phone: senderPhone,
            sender_name: senderName,
            chat_id: msg.from,
            chat_name: chatName,
            message_type: messageType,
            text_content: textContent,
            media_url: mediaUrl,
            media_type: mediaType,
            is_deleted: isRescued,
            raw_metadata: {
                fromMe: msg.fromMe,
                hasMedia: msg.hasMedia,
                isForwarded: msg.isForwarded,
                isStatus: msg.isStatus,
                isRescued: isRescued
            }
        };

        await supabase.saveMessage(messageRecord);

        if (textContent) {
            logger.success(`Saved text: "${textContent.length > 50 ? textContent.substring(0, 50) + '...' : textContent}"`);
        } else if (mediaUrl) {
            logger.success(`Saved media: ${mediaUrl}`);
        }
    } catch (err) {
        logger.error('Error handling incoming message:', err.message);
    }
}

/**
 * Event: Message Received (The Listener)
 */
client.on('message', (msg) => handleMessage(msg, false));
client.on('message_create', (msg) => {
    if (msg.fromMe) handleMessage(msg, false);
});

/**
 * Event: Message Revoke Everyone (The Deletion Bypass!)
 */
client.on('message_revoke_everyone', async (after, before) => {
    try {
        const revokedId = (before && before.id && before.id._serialized) || 
                          (after && after.id && after.id._serialized) ||
                          (after && after.id);

        logger.bypass(`🚨 ALERT: Someone clicked "Delete for Everyone"! Intercepting...`);
        
        let marked = false;
        if (revokedId) {
            marked = await supabase.markMessageAsDeleted(revokedId);
        } else {
            logger.warn('Could not extract message ID from revocation event.');
        }

        // RESCUE SAVE: If message wasn't in DB yet (e.g. missed filter or arrived offline), save it now from cache!
        if (!marked && before) {
            logger.bypass(`🛟 RESCUE SAVE: Saving deleted message directly to Supabase database!`);
            logger.bypass(`🛡️ PRESERVED CONTENT: "${before.body || '[Media File]'}"`);
            await handleMessage(before, true);
        } else if (before) {
            logger.bypass(`🛡️ PRESERVED CONTENT: "${before.body || '[Media File]'}"`);
        }
    } catch (err) {
        logger.error('Error handling message revocation:', err.message);
    }
});

/**
 * Event: Disconnected
 */
client.on('disconnected', (reason) => {
    isAuthenticated = false;
    currentQrDataUrl = null;
    logger.warn('WhatsApp Client was disconnected:', reason);
});

/**
 * Graceful Shutdown Handlers
 */
process.on('SIGINT', async () => {
    logger.info('Shutting down auto-saver gracefully...');
    try {
        await client.destroy();
    } catch (e) {}
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Shutting down auto-saver gracefully...');
    try {
        await client.destroy();
    } catch (e) {}
    process.exit(0);
});

// Clean up any stale Chromium SingletonLock files left by abrupt container restarts
try {
    const fs = require('fs');
    const path = require('path');
    const authDir = path.join(__dirname, '..', '.wwebjs_auth');
    if (fs.existsSync(authDir)) {
        const cleanLocks = (dir) => {
            const files = fs.readdirSync(dir, { withFileTypes: true });
            for (const file of files) {
                const fullPath = path.join(dir, file.name);
                if (file.isDirectory()) {
                    cleanLocks(fullPath);
                } else if (file.name.includes('SingletonLock') || file.name.includes('SingletonCookie') || file.name.includes('SingletonSocket')) {
                    try {
                        fs.unlinkSync(fullPath);
                        logger.info(`🧹 Cleaned stale browser lock file: ${file.name}`);
                    } catch (e) {}
                }
            }
        };
        cleanLocks(authDir);
    }
} catch (e) {}

// Start the client
logger.info('Initializing WhatsApp Web browser instance...');
client.initialize();
