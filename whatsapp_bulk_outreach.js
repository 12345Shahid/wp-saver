const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const CSV_PATH = path.join(__dirname, '..', 'dallas_247_roofers.csv');
const RESULTS_CSV = path.join(__dirname, '..', 'whatsapp_outreach_results.csv');

// Custom video demo message template
const MESSAGE_TEMPLATE = (companyName) => `Hey there! This is Sarah from CH Solutions. 

I came across ${companyName} on Google Maps—I noticed you offer emergency roofing in Dallas, so I actually built a free custom high-converting website preview for your team as a gift!

Here is a quick 2-minute video walkthrough:
https://createhalal.com/demo-preview

Let me know if you'd like to check out the live site or if you have any questions!`;

console.log("==================================================");
console.log("🚀 Starting WhatsApp Bulk Verifier & Auto-Texter");
console.log("==================================================");

// Function to parse CSV
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length <= 1) return [];
  
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const items = [];
  
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/"/g, '').trim());
    if (cols.length >= 2) {
      items.append ? null : items.push({
        company: cols[0] || 'Roofing Team',
        phone: cols[1],
        website: cols[2] || '',
        status: cols[7] || 'pending'
      });
    }
  }
  return items;
}

const leads = parseCSV(CSV_PATH);
console.log(`📋 Loaded ${leads.length} leads from ${path.basename(CSV_PATH)}`);

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', (qr) => {
  console.log('\n📲 SCAN THIS QR CODE WITH YOUR WHATSAPP TO CONNECT:\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp authenticated successfully!');
});

client.on('ready', async () => {
  console.log('🎉 WhatsApp Client Ready! Starting bulk verification & outreach...\n');
  
  const results = [];
  
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const cleanDigits = lead.phone.replace(/\D/g, '');
    if (!cleanDigits) continue;
    
    const formattedId = `${cleanDigits}@c.us`;
    console.log(`[${i+1}/${leads.length}] Checking ${lead.company} (${lead.phone})...`);
    
    try {
      // 1. Verify WhatsApp Registration
      const isRegistered = await client.isRegisteredUser(formattedId);
      
      if (isRegistered) {
        console.log(`   ✅ WhatsApp REGISTERED! Sending video demo link...`);
        const text = MESSAGE_TEMPLATE(lead.company);
        await client.sendMessage(formattedId, text);
        console.log(`   📩 Message SENT to ${lead.phone}!`);
        
        results.push({ ...lead, whatsapp_registered: 'YES', status: 'sent', timestamp: new Date().toISOString() });
        
        // Random safety delay between 20s and 40s
        const delayMs = Math.floor(Math.random() * (40000 - 20000 + 1)) + 20000;
        console.log(`   ⏳ Waiting ${Math.round(delayMs/1000)}s before next message...\n`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.log(`   ⚠️ Number not registered on WhatsApp. Skipping.\n`);
        results.push({ ...lead, whatsapp_registered: 'NO', status: 'skipped', timestamp: new Date().toISOString() });
      }
    } catch (err) {
      console.error(`   ❌ Error processing ${lead.phone}:`, err.message);
      results.push({ ...lead, whatsapp_registered: 'ERROR', status: 'failed', timestamp: new Date().toISOString() });
    }
  }
  
  // Save results CSV
  const csvHeaders = "Company Name,Phone Number,Website,WhatsApp Registered,Status,Timestamp\n";
  const csvRows = results.map(r => `"${r.company}","${r.phone}","${r.website}","${r.whatsapp_registered}","${r.status}","${r.timestamp}"`).join('\n');
  fs.writeFileSync(RESULTS_CSV, csvHeaders + csvRows, 'utf8');
  
  console.log("==================================================");
  console.log(`✨ WhatsApp Outreach Batch Completed!`);
  console.log(`💾 Saved detailed results to: ${RESULTS_CSV}`);
  console.log("==================================================");
  
  process.exit(0);
});

client.initialize();
