# 🤖 WhatsApp Auto-Saver & Deletion Bypass (Level 1)

A custom Node.js application powered by `whatsapp-web.js` and Supabase. It captures incoming messages, voice notes, images, and videos in real-time, archiving them safely to your database and storage. Even if the sender clicks **"Delete for Everyone"**, your script has already secured the original message!

---

## ✨ Features (Level 1)

1. **⚡ Real-Time Listener:** Instantly catches incoming messages the millisecond they arrive.
2. **💬 Text & Metadata Archiving:** Saves timestamp, sender phone, contact name, chat ID, and text directly to your Supabase PostgreSQL database.
3. **📥 Media Catching (Voice Notes & Images):** Automatically downloads voice notes, photos, and videos into computer memory and uploads them directly to Supabase Storage.
4. **🛡️ The Deletion Bypass:** Listens for `message_revoke_everyone` events. When a sender deletes a message for everyone, your script intercepts it, marks `is_deleted = true` in your database, and preserves the original text/media untouched!
5. **🎯 Target Filtering:** Option to filter messages to only capture chats from a specific person (e.g., your girlfriend) or capture everything.
6. **💾 Local Session Persistence:** Uses `LocalAuth` so you only scan the QR code once!

---

## 🚀 Step-by-Step Setup Guide

### 1. Supabase Database & Storage Setup (100% Free)
1. Go to [Supabase.com](https://supabase.com) and create a free project.
2. **Setup Database Schema:**
   - In your Supabase Dashboard, go to **SQL Editor**.
   - Copy the entire contents of [`schema.sql`](file:///Users/shahidhasan/createHalal/calls/whatsapp-auto-saver/schema.sql) and run it. This creates the `whatsapp_messages` table and helpful indexes.
3. **Setup Storage Bucket:**
   - Go to **Storage** in the left sidebar of your Supabase Dashboard.
   - Click **New Bucket**, name it exactly: `whatsapp-media`
   - Make sure to check **Public Bucket** so you can click and view media URLs easily!
4. **Get Credentials:**
   - Go to **Project Settings** -> **API**.
   - Copy your **Project URL** (`https://...supabase.co`) and your **API Key** (`service_role` key or `anon` key).

---

### 2. Installation
Open your terminal in this directory and install dependencies:
```bash
cd whatsapp-auto-saver
npm install
```

---

### 3. Configuration
1. Open the `.env` file (or copy `.env.example` to `.env`):
   ```bash
   cp .env.example .env
   ```
2. Fill in your credentials:
   ```env
   SUPABASE_URL="https://your-project-id.supabase.co"
   SUPABASE_KEY="your-supabase-key"
   SUPABASE_BUCKET="whatsapp-media"

   # Optional: Set a specific phone number or contact name to filter
   TARGET_FILTER=""
   ```

---

### 4. Running the Auto-Saver
Start the application:
```bash
npm start
```
1. A **QR Code** will appear in your terminal.
2. Open **WhatsApp** on your phone -> **Settings** (or 3 dots) -> **Linked Devices** -> **Link a Device**.
3. Scan the QR code on your screen.
4. Once connected, you will see: `🤖 WHATSAPP AUTO-SAVER IS ONLINE AND CONNECTED!`

---

## 🧪 How to Test the Deletion Bypass

1. Ask your target contact (or send a message from an alternate phone) to send you a text or photo.
2. Watch your terminal log: `✅ Saved text: "..."` or `✅ Saved media: https://...`
3. Have them click **"Delete for Everyone"** on their phone.
4. Watch your terminal log trigger the interception:
   `🚨 ALERT: Someone clicked "Delete for Everyone"! Intercepting...`
   `🛡️ PRESERVED CONTENT: "..."`
5. Open your Supabase Dashboard -> Table Editor -> `whatsapp_messages`. You will see the original message is still there, with `is_deleted` set to `TRUE`!

---

## 📁 Project Structure

- **`src/index.js`**: Main WhatsApp client, event listeners, and media downloading logic.
- **`src/supabase.js`**: Database connector for inserting messages and uploading media buffers.
- **`src/logger.js`**: Terminal logging utility with timestamps and status icons.
- **`schema.sql`**: Complete PostgreSQL script for initializing your Supabase database.
- **`.env`**: Your private keys and filter settings (ignored by Git).

---

## ☁️ 24/7 Cloud Deployment on Railway (With Persistent Session Volume)

To run this auto-saver 24/7 in the cloud without needing your computer on, deploy to **Railway**:

### 1. Push to GitHub
Commit and push this project to your GitHub repository:
```bash
git init
git add .
git commit -m "Deploy WhatsApp Auto-Saver"
git branch -M main
git remote add origin https://github.com/12345Shahid/wp-saver.git
git push -u origin main
```

### 2. Deploy on Railway Dashboard
1. Go to [railway.app](https://railway.app) and create a New Project -> **Deploy from GitHub repo**.
2. Select your `wp-saver` repository. Railway will automatically detect the included `Dockerfile` and install system Chromium!
3. Go to the **Variables** tab of your service in Railway and add your `.env` variables (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_BUCKET`, `TARGET_FILTER`).

### 3. Attach a Persistent Volume (CRITICAL for scanning QR once!)
To ensure you never have to scan the QR code again after restarts:
1. In Railway Dashboard, click **+ Add** -> **Volume**.
2. Name it `whatsapp-session` and attach it to your service.
3. In your service settings -> **Volumes**, set the **Mount Path** to:
   `/app/.wwebjs_auth`
4. Deploy! Click on your service -> **Logs** tab in Railway to see the QR code. Scan it once with your phone, and your bot will run 24/7 forever!

### Option: Deploy via Railway CLI (Terminal)
If you prefer deploying directly from your terminal using Railway's Personal Access Token:
```bash
npm i -g @railway/cli
export RAILWAY_TOKEN="your_personal_access_token_here"
railway link
railway up
```
