/**
 * WHATSAPP AUTO-SAVER (LEVEL 1) — Baileys Edition
 * Captures all incoming messages and media in real-time, archiving them to Supabase
 * PostgreSQL & Storage to bypass "Delete for Everyone" removals.
 *
 * Uses @whiskeysockets/baileys (direct WebSocket protocol) instead of
 * whatsapp-web.js (Puppeteer browser automation), making it immune to
 * WhatsApp Web UI changes like the July 2026 _serialized → $1 rename.
 */

require('dotenv').config();
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}
}

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    getContentType,
    proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const logger = require('./logger');
const supabase = require('./supabase');
const express = require('express');
const qrcodeImage = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
let currentQrDataUrl = null;
let isAuthenticated = false;

// ── Web Dashboard ──────────────────────────────────────────────────
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
            <p style="font-size: 12px; color: #64748b;">Page auto-refreshes every 3s.</p>
        ` : `
            <div class="badge waiting">● CONNECTING...</div>
            <p>Connecting to WhatsApp servers. Please wait for the QR code to appear...</p>
        `}
        <div class="footer">WhatsApp Auto-Saver & Deletion Bypass (Level 1) — Baileys Engine</div>
    </div>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🌐 Web Dashboard online! Visit http://localhost:${PORT} or your cloud domain URL to view the QR scanner.`);
});

// ── Show start banner ──────────────────────────────────────────────
logger.banner();

// ── Config ─────────────────────────────────────────────────────────
const targetFilter = process.env.TARGET_FILTER ? process.env.TARGET_FILTER.replace(/^["']|["']$/g, '').trim().toLowerCase() : null;
if (targetFilter) {
    logger.info(`🎯 TARGET FILTER ACTIVE: Only capturing messages matching "${targetFilter}"`);
} else {
    logger.info(`🌐 NO FILTER SET: Capturing messages from ALL incoming chats.`);
}

const processedMessageIds = new Set();
const AUTH_DIR = path.join(__dirname, '..', 'auth_info_baileys');

// ── Main Connection Logic ──────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        logger: pino({ level: 'silent' }),
        browser: ['WhatsApp Auto-Saver', 'Chrome', '126.0.0'],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,  // presence cloak: don't show "online"
    });

    // ── Save credentials on update ─────────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── Connection updates (QR, auth, disconnect) ──────────────────
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                currentQrDataUrl = await qrcodeImage.toDataURL(qr, { width: 300, margin: 1 });
            } catch (e) {}
            isAuthenticated = false;
            logger.qr('====================================================================');
            logger.qr('🌐 WEB DASHBOARD ACTIVE! Open http://localhost:3000 or your domain URL');
            logger.qr('in a browser tab to view a clean, styled QR scanner box!');
            logger.qr('====================================================================');
            const qrImageUrl = `https://quickchart.io/qr?size=220&margin=1&text=${encodeURIComponent(qr)}`;
            console.log(`\n${qrImageUrl}\n`);
            logger.info('Waiting for QR code scan from your phone...');
        }

        if (connection === 'close') {
            if (global.presenceInterval) clearInterval(global.presenceInterval);
            isAuthenticated = false;
            currentQrDataUrl = null;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (statusCode === DisconnectReason.loggedOut) {
                logger.error('Session logged out! Clearing auth data and restarting...');
                try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
                setTimeout(() => process.exit(1), 1000);
            } else {
                logger.warn(`Connection closed (code: ${statusCode}). Reconnecting in 3s...`);
                if (shouldReconnect) {
                    setTimeout(() => startBot(), 3000);
                }
            }
        }

        if (connection === 'open') {
            isAuthenticated = true;
            currentQrDataUrl = null;
            logger.success('🤖 WHATSAPP AUTO-SAVER IS ONLINE AND CONNECTED!');
            logger.info('Listening for incoming text messages, voice notes, images, and deletions...');
            await supabase.testConnection();

            // Presence cloak: keep "offline" appearance
            try {
                await sock.sendPresenceUpdate('unavailable');
                logger.info('🥷 Presence cloak activated: Bot will run silently without showing you "Online" 24/7.');
                
                // Aggressively re-apply offline status every 15 seconds to fight server-side overrides
                if (global.presenceInterval) clearInterval(global.presenceInterval);
                global.presenceInterval = setInterval(async () => {
                    try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
                }, 15000); // 15 seconds is fast enough to stay hidden without triggering spam filters
            } catch (e) {
                logger.warn('Could not activate presence cloak:', e.message);
            }
        }
    });

    // ── Incoming messages ──────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const msg of messages) {
            try {
                // Only process real-time messages (type === 'notify'), skip history sync
                if (type !== 'notify') continue;

                // Skip status broadcasts
                if (msg.key.remoteJid === 'status@broadcast') continue;

                // Skip protocol/system messages with no content
                if (!msg.message) continue;

                // Extract message content type
                const contentType = getContentType(msg.message);
                if (!contentType) continue;

                // Skip protocol messages
                if (contentType === 'protocolMessage' || contentType === 'senderKeyDistributionMessage') continue;

                await handleMessage(sock, msg);
            } catch (err) {
                logger.error('Error processing incoming message:', err.message);
            }
        }
    });

    // ── Message updates (deletion bypass) ──────────────────────────
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            try {
                // Check if message was deleted ("revoked")
                if (update.update?.message === null || update.update?.messageStubType === proto.WebMessageInfo.StubType.REVOKE) {
                    const revokedId = update.key.id;
                    const fromJid = update.key.remoteJid;

                    logger.bypass(`🚨 ALERT: Someone clicked "Delete for Everyone"! Intercepting...`);
                    logger.bypass(`Message ID: ${revokedId} from ${fromJid}`);

                    if (revokedId) {
                        const marked = await supabase.markMessageAsDeleted(revokedId);
                        if (marked) {
                            logger.bypass(`🛡️ SUCCESS! Deletion intercepted — original content preserved in DB!`);
                        } else {
                            logger.warn(`Message ID ${revokedId} was not in DB yet.`);
                        }
                    }
                }
            } catch (err) {
                logger.error('Error handling message update/deletion:', err.message);
            }
        }
    });

    return sock;
}

// ── Core message handler ───────────────────────────────────────────
async function handleMessage(sock, msg) {
    try {
        const messageId = msg.key.id;

        // Deduplication
        if (messageId && processedMessageIds.has(messageId)) return;
        if (messageId) {
            processedMessageIds.add(messageId);
            if (processedMessageIds.size > 20000) {
                const first = processedMessageIds.values().next().value;
                if (first) processedMessageIds.delete(first);
            }
        }

        const fromMe = msg.key.fromMe || false;
        const remoteJid = msg.key.remoteJid || '';
        const participant = msg.key.participant || ''; // group message sender
        const isGroup = remoteJid.endsWith('@g.us');

        // Extract phone numbers
        const senderJid = fromMe ? (sock.user?.id || '') : (isGroup ? participant : remoteJid);
        const senderPhone = jidToPhone(senderJid);
        const chatId = remoteJid;

        // Get push name
        const senderName = msg.pushName || senderPhone || 'Unknown';
        const chatName = isGroup ? (remoteJid.split('@')[0] || 'Group') : senderName;

        // Apply Target Filter
        if (targetFilter) {
            const filterDigits = targetFilter.replace(/\D/g, '');
            const senderDigits = senderPhone.replace(/\D/g, '');
            const chatDigits = chatId.replace(/\D/g, '');

            const matchPhone = filterDigits && (
                senderDigits.includes(filterDigits) ||
                chatDigits.includes(filterDigits)
            );
            const matchName = senderName.toLowerCase().includes(targetFilter) || chatName.toLowerCase().includes(targetFilter);

            if (!matchPhone && !matchName) {
                logger.info(`⏭️ [FILTERED] Ignored message from "${senderName}" (${senderPhone}) - did not match filter "${targetFilter}"`);
                return;
            }
        }

        // Extract message content
        const contentType = getContentType(msg.message);
        let textContent = '';
        let mediaUrl = null;
        let mediaType = null;
        const messageType = contentType || 'chat';

        // Get text content from various message types
        if (msg.message?.conversation) {
            textContent = msg.message.conversation;
        } else if (msg.message?.extendedTextMessage?.text) {
            textContent = msg.message.extendedTextMessage.text;
        } else if (msg.message?.imageMessage?.caption) {
            textContent = msg.message.imageMessage.caption;
        } else if (msg.message?.videoMessage?.caption) {
            textContent = msg.message.videoMessage.caption;
        } else if (msg.message?.documentMessage?.caption) {
            textContent = msg.message.documentMessage.caption;
        } else if (msg.message?.buttonsResponseMessage?.selectedDisplayText) {
            textContent = msg.message.buttonsResponseMessage.selectedDisplayText;
        } else if (msg.message?.listResponseMessage?.title) {
            textContent = msg.message.listResponseMessage.title;
        } else if (msg.message?.templateButtonReplyMessage?.selectedDisplayText) {
            textContent = msg.message.templateButtonReplyMessage.selectedDisplayText;
        }

        logger.info(`📬 [${fromMe ? 'OUTGOING' : 'INCOMING'}] [${messageType.toUpperCase()}] from "${senderName}" (${senderPhone}) in "${chatName}"`);

        // Handle media downloads
        const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
        if (mediaTypes.includes(contentType)) {
            try {
                const mediaMsg = msg.message[contentType];
                const mimeType = mediaMsg?.mimetype || 'application/octet-stream';
                mediaType = mimeType;

                const mediaLimitMB = parseInt(process.env.MEDIA_DOWNLOAD_LIMIT_MB || '25', 10);
                const fileSizeBytes = mediaMsg?.fileLength ? Number(mediaMsg.fileLength) : 0;
                const fileSizeMB = fileSizeBytes / (1024 * 1024);

                if (fileSizeMB > mediaLimitMB && mediaLimitMB > 0) {
                    logger.warn(`⏭️ Skipping media download (${fileSizeMB.toFixed(1)}MB exceeds ${mediaLimitMB}MB limit)`);
                } else {
                    logger.media(`Downloading ${contentType} (${mimeType})...`);
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        {
                            logger: pino({ level: 'silent' }),
                            reuploadRequest: sock.updateMediaMessage
                        }
                    );

                    if (buffer && buffer.length > 0) {
                        const ext = getExtFromMime(mimeType);
                        const filename = mediaMsg?.fileName || `${contentType}_${messageId}${ext}`;
                        mediaUrl = await supabase.uploadMedia(buffer, filename, mimeType);
                    }
                }
            } catch (mediaErr) {
                logger.error('Failed to download/upload media:', mediaErr.message);
            }
        }

        // Build timestamp
        const timestamp = msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
            : new Date().toISOString();

        const messageRecord = {
            message_id: messageId,
            timestamp: timestamp,
            sender_phone: senderPhone,
            sender_name: senderName,
            chat_id: chatId,
            chat_name: chatName,
            message_type: messageType.replace('Message', ''),
            text_content: textContent,
            media_url: mediaUrl,
            media_type: mediaType,
            is_deleted: false,
            raw_metadata: {
                fromMe: fromMe,
                hasMedia: mediaTypes.includes(contentType),
                isGroup: isGroup,
                participant: participant,
                contentType: contentType
            }
        };

        await supabase.saveMessage(messageRecord);

        if (textContent) {
            logger.success(`Saved text: "${textContent.length > 50 ? textContent.substring(0, 50) + '...' : textContent}"`);
        } else if (mediaUrl) {
            logger.success(`Saved media: ${mediaUrl}`);
        } else {
            logger.success(`Saved message metadata (ID: ${messageId})`);
        }
    } catch (err) {
        logger.error('Error handling incoming/outgoing message:', err.message);
    }
}

// ── Helpers ────────────────────────────────────────────────────────
function jidToPhone(jid) {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0];
}

function getExtFromMime(mime) {
    if (!mime) return '';
    const map = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'video/mp4': '.mp4',
        'video/3gpp': '.3gp',
        'audio/ogg': '.ogg',
        'audio/ogg; codecs=opus': '.ogg',
        'audio/mpeg': '.mp3',
        'audio/mp4': '.m4a',
        'application/pdf': '.pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    };
    const clean = mime.split(';')[0].trim();
    return map[clean] || '';
}

// ── Graceful Shutdown ──────────────────────────────────────────────
process.on('SIGINT', async () => {
    logger.info('Shutting down auto-saver gracefully...');
    if (global.presenceInterval) clearInterval(global.presenceInterval);
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Shutting down auto-saver gracefully...');
    if (global.presenceInterval) clearInterval(global.presenceInterval);
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    const errText = (reason && (reason.stack || reason.message || reason.toString())) || '';
    logger.error('Unhandled Rejection detected:', errText);
});

process.on('uncaughtException', (err) => {
    const errText = (err && (err.stack || err.message || err.toString())) || '';
    logger.error('Uncaught Exception detected:', errText);
    if (errText.includes('ECONNRESET') || errText.includes('ETIMEDOUT')) {
        logger.warn('Network error — will attempt reconnection automatically.');
    } else {
        setTimeout(() => process.exit(1), 1000);
    }
});

// ── Start ──────────────────────────────────────────────────────────
logger.info('Initializing WhatsApp connection (Baileys engine)...');
startBot().catch((err) => {
    logger.error('Fatal error starting bot:', err.message);
    setTimeout(() => process.exit(1), 1000);
});
