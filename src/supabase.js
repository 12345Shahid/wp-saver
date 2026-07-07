/**
 * Supabase Database and Storage connector for WhatsApp Auto-Saver
 */
require('dotenv').config();
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}
}
if (typeof global.WebSocket === 'undefined') {
    try { global.WebSocket = require('ws'); } catch (e) {}
}
const { createClient } = require('@supabase/supabase-js');
const logger = require('./logger');

let supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '');
const supabaseKey = (process.env.SUPABASE_KEY || '').trim().replace(/^["']|["']$/g, '');
const bucketName = (process.env.SUPABASE_BUCKET || 'whatsapp-media').trim().replace(/^["']|["']$/g, '');

// Clean trailing slashes or /rest/v1/ if user accidentally pasted the REST URL instead of base Project URL
if (supabaseUrl) {
    supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

let supabase = null;
let isConfigured = false;

if (supabaseUrl && supabaseUrl.startsWith('http') && supabaseKey && supabaseKey !== '') {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
        isConfigured = true;
    } catch (err) {
        logger.error('Failed to initialize Supabase client:', err.message);
    }
} else {
    logger.warn('Supabase URL or Key not found in .env file!');
    logger.warn('Running in LOCAL SIMULATION MODE: Messages will be logged to terminal but not saved to cloud DB.');
    logger.warn('To enable Cloud Saving, add your credentials to the .env file.');
}

/**
 * Test Supabase DB connection on startup
 */
async function testConnection(retries = 3) {
    if (!isConfigured) return false;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const { error } = await supabase.from('whatsapp_messages').select('id').limit(1);
            if (error) {
                if (error.code === '42P01') {
                    logger.error('Table "whatsapp_messages" does not exist in your Supabase database!');
                    logger.info('Please run the SQL script inside schema.sql in your Supabase SQL Editor.');
                    return false;
                }
                if (attempt === retries) {
                    logger.error('Supabase connection test failed:', error.message);
                    return false;
                }
                logger.warn(`Supabase connection test attempt ${attempt}/${retries} failed (${error.message}). Retrying in 2s...`);
                await new Promise(res => setTimeout(res, 2000));
                continue;
            }
            logger.success('Connected to Supabase PostgreSQL database successfully!');
            return true;
        } catch (err) {
            if (attempt === retries) {
                logger.error('Unexpected error connecting to Supabase:', err.message);
                return false;
            }
            logger.warn(`Supabase connection attempt ${attempt}/${retries} threw (${err.message}). Retrying in 2s...`);
            await new Promise(res => setTimeout(res, 2000));
        }
    }
    return false;
}

/**
 * Upload downloaded media buffer to Supabase Storage
 * @param {Buffer} buffer - File data in memory
 * @param {string} filename - Desired filename
 * @param {string} mimeType - MIME type (e.g. image/jpeg)
 * @returns {Promise<string|null>} - Secure URL of uploaded file
 */
async function uploadMedia(buffer, filename, mimeType) {
    if (!isConfigured) {
        logger.media(`[SIMULATION] Would upload media to storage: ${filename} (${mimeType})`);
        return `https://simulation.local/media/${filename}`;
    }

    try {
        // Create clean unique filename
        const timestamp = Date.now();
        const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const filePath = `${timestamp}_${safeFilename}`;

        // Clean MIME type (strip parameters like '; codecs=opus' which can cause Supabase Storage upload errors for voice notes)
        const cleanContentType = mimeType ? mimeType.split(';')[0].trim() : 'application/octet-stream';

        logger.media(`Uploading media to Supabase Storage (${bucketName}/${filePath}) as ${cleanContentType}...`);

        const { data, error } = await supabase.storage
            .from(bucketName)
            .upload(filePath, buffer, {
                contentType: cleanContentType,
                upsert: true
            });

        if (error) {
            if (error.message.includes('bucket not found') || error.statusCode === '"404"') {
                logger.error(`Storage bucket "${bucketName}" not found! Please create it in Supabase Dashboard.`);
            } else {
                logger.error(`Failed to upload media to Supabase Storage:`, error.message);
            }
            return null;
        }

        // Retrieve public URL
        const { data: urlData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);

        const publicUrl = urlData?.publicUrl;
        logger.success(`Media uploaded successfully! URL secured.`);
        return publicUrl;
    } catch (err) {
        logger.error('Exception during media upload:', err.message);
        return null;
    }
}

/**
 * Save message metadata and content to PostgreSQL
 * @param {Object} messageData - Structured message data
 */
async function saveMessage(messageData) {
    if (!isConfigured) {
        logger.database(`[SIMULATION] Saving message record:`, {
            sender: messageData.sender_name || messageData.sender_phone,
            type: messageData.message_type,
            text: messageData.text_content,
            media: messageData.media_url
        });
        return true;
    }

    try {
        const { data, error } = await supabase
            .from('whatsapp_messages')
            .upsert([messageData], { onConflict: 'message_id' })
            .select();

        if (error) {
            logger.error('Failed to save message to Supabase database:', error.message);
            return false;
        }

        logger.database(`Message secured in Supabase database! ID: ${data?.[0]?.id || messageData.message_id}`);
        return true;
    } catch (err) {
        logger.error('Exception saving message to DB:', err.message);
        return false;
    }
}

/**
 * Mark a message as deleted when intercepted by revocation event (Deletion Bypass)
 * @param {string} messageId - WhatsApp message ID
 */
async function markMessageAsDeleted(messageId) {
    if (!isConfigured) {
        logger.bypass(`[SIMULATION] Message ${messageId} marked as DELETED! Original content preserved.`);
        return true;
    }

    try {
        const { data, error } = await supabase
            .from('whatsapp_messages')
            .update({ is_deleted: true })
            .eq('message_id', messageId)
            .select();

        if (error) {
            logger.error(`Failed to update deleted status for message ${messageId}:`, error.message);
            return false;
        }

        if (data && data.length > 0) {
            const msg = data[0];
            logger.bypass(`🛡️ SUCCESS! Intercepted deletion attempt from ${msg.sender_name || msg.sender_phone}!`);
            logger.bypass(`Content preserved in DB: "${msg.text_content || '[Media File]'}"`);
            return true;
        } else {
            logger.warn(`Message ID ${messageId} was not in DB yet (possibly arrived while offline or before filter match). Initiating rescue save...`);
            return false;
        }
    } catch (err) {
        logger.error('Exception marking message as deleted:', err.message);
        return false;
    }
}

module.exports = {
    supabase,
    isConfigured,
    testConnection,
    uploadMedia,
    saveMessage,
    markMessageAsDeleted
};
