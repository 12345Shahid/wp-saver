-- ====================================================================
-- SUPABASE DATABASE SCHEMA FOR WHATSAPP AUTO-SAVER (LEVEL 1)
-- ====================================================================
-- Instructions:
-- 1. Open your Supabase Dashboard -> Project -> SQL Editor
-- 2. Paste this entire script into a new query and click "Run"
-- 3. Go to "Storage" in the left sidebar and create a new bucket named:
--    whatsapp-media
--    (Make sure to set the bucket as "Public" if you want easy media viewing)
-- ====================================================================

-- Create table to store all incoming WhatsApp messages
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id TEXT UNIQUE NOT NULL,       -- Unique WhatsApp Message ID (_serialized)
    timestamp TIMESTAMPTZ NOT NULL,        -- Exact timestamp when message was sent
    sender_phone TEXT NOT NULL,            -- Sender's WhatsApp ID/phone (e.g. 1234567890@c.us)
    sender_name TEXT,                      -- Contact pushname or profile name
    chat_id TEXT NOT NULL,                 -- Chat ID where message originated
    chat_name TEXT,                        -- Name of the chat or contact
    message_type TEXT NOT NULL,            -- e.g. 'chat', 'image', 'video', 'ptt', 'audio', 'document'
    text_content TEXT,                     -- Text message body or media caption
    media_url TEXT,                        -- Supabase Storage URL if media was downloaded
    media_type TEXT,                       -- MIME type (e.g., 'image/jpeg', 'audio/ogg')
    is_deleted BOOLEAN DEFAULT false,      -- Marked TRUE if sender clicks "Delete for Everyone"
    raw_metadata JSONB DEFAULT '{}'::jsonb,-- Optional storage for additional message metadata
    created_at TIMESTAMPTZ DEFAULT NOW()   -- When our script captured and saved the record
);

-- Add comments for documentation in Supabase Dashboard
COMMENT ON TABLE public.whatsapp_messages IS 'Stores real-time WhatsApp messages and captures deleted messages (Deletion Bypass).';
COMMENT ON COLUMN public.whatsapp_messages.is_deleted IS 'True when intercepted by message_revoke_everyone event after sender deleted it.';

-- Create indexes for fast querying and filtering by sender, chat, or deletion status
CREATE INDEX IF NOT EXISTS idx_wa_messages_sender ON public.whatsapp_messages(sender_phone);
CREATE INDEX IF NOT EXISTS idx_wa_messages_chat ON public.whatsapp_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_timestamp ON public.whatsapp_messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_is_deleted ON public.whatsapp_messages(is_deleted) WHERE is_deleted = true;

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) & STORAGE SETUP
-- ====================================================================
-- Enable RLS on the table (good practice)
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Allow full access when using service_role key or authenticated scripts
CREATE POLICY "Allow service role full access to messages"
ON public.whatsapp_messages
FOR ALL
USING (true)
WITH CHECK (true);

-- Optional: Create a view specifically for reviewing deleted messages easily!
CREATE OR REPLACE VIEW public.intercepted_deleted_messages AS
SELECT 
    timestamp,
    sender_name,
    sender_phone,
    chat_name,
    message_type,
    text_content,
    media_url,
    created_at
FROM public.whatsapp_messages
WHERE is_deleted = true
ORDER BY timestamp DESC;

COMMENT ON VIEW public.intercepted_deleted_messages IS 'Quick view of all messages that senders attempted to Delete for Everyone.';

-- ====================================================================
-- STORAGE BUCKET RLS POLICY (Required for media uploads via anon key)
-- ====================================================================
-- This policy allows voice notes, photos, and videos to be uploaded to the whatsapp-media bucket without RLS violation errors.
CREATE POLICY "Allow uploads and reads for whatsapp-media bucket"
ON storage.objects
FOR ALL
USING (bucket_id = 'whatsapp-media')
WITH CHECK (bucket_id = 'whatsapp-media');
