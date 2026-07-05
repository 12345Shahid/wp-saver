/**
 * Logger utility for WhatsApp Auto-Saver
 * Provides clean, formatted terminal output with timestamps and visual icons.
 */

const getTimestamp = () => {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
};

const formatMessage = (icon, label, message, extra = '') => {
    const time = `[${getTimestamp()}]`;
    const prefix = `${time} ${icon} [${label}]`;
    if (extra) {
        return `${prefix} ${message}\n    └─> ${typeof extra === 'object' ? JSON.stringify(extra) : extra}`;
    }
    return `${prefix} ${message}`;
};

const logger = {
    info: (message, extra) => {
        console.log(formatMessage('ℹ️', 'INFO', message, extra));
    },
    success: (message, extra) => {
        console.log(formatMessage('✅', 'SUCCESS', message, extra));
    },
    warn: (message, extra) => {
        console.warn(formatMessage('⚠️', 'WARN', message, extra));
    },
    error: (message, extra) => {
        console.error(formatMessage('❌', 'ERROR', message, extra));
    },
    media: (message, extra) => {
        console.log(formatMessage('📥', 'MEDIA', message, extra));
    },
    database: (message, extra) => {
        console.log(formatMessage('💾', 'SUPABASE', message, extra));
    },
    bypass: (message, extra) => {
        console.log(formatMessage('🚨', 'DELETION-BYPASS', message, extra));
    },
    qr: (message) => {
        console.log(`\n====================================================================`);
        console.log(`📱 ${message}`);
        console.log(`====================================================================\n`);
    },
    banner: () => {
        console.clear();
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║        🤖 WHATSAPP AUTO-SAVER & DELETION BYPASS (LEVEL 1)        ║
╠══════════════════════════════════════════════════════════════════╣
║  • Captures real-time incoming messages automatically            ║
║  • Downloads media (images, voice notes, videos) into memory     ║
║  • Uploads media & text directly to Supabase PostgreSQL & Storage║
║  • Bypasses "Delete for Everyone" by securing messages instantly ║
╚══════════════════════════════════════════════════════════════════╝
`);
    }
};

module.exports = logger;
