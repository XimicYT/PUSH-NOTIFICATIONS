const express = require('express');
const webPush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Filter = require('bad-words'); 

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); 

const publicVapidKey = process.env.PUBLIC_VAPID_KEY;
const privateVapidKey = process.env.PRIVATE_VAPID_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const BUCKET_NAME = 'notifications';

const supabase = createClient(supabaseUrl, supabaseKey);
webPush.setVapidDetails('mailto:student@example.com', publicVapidKey, privateVapidKey);

const filter = new Filter();
filter.addWords('sucks', 'freaking', 'poop'); 

async function deleteImage(fileName) {
    await supabase.storage.from(BUCKET_NAME).remove([fileName]);
}

async function cleanOldFiles() {
    console.log("🧹 Cleaning old images...");
    const { data: files } = await supabase.storage.from(BUCKET_NAME).list();
    if (files && files.length > 0) {
        const fileNames = files.map(f => f.name);
        await supabase.storage.from(BUCKET_NAME).remove(fileNames);
    }
}
cleanOldFiles();

app.post('/subscribe', async (req, res) => {
    const subData = req.body;
    await supabase.from('subscriptions').delete().match({ payload: subData });
    const { error } = await supabase.from('subscriptions').insert({ payload: subData });
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({});
});

app.post('/unsubscribe', async (req, res) => {
    const subData = req.body;
    const { error } = await supabase.from('subscriptions').delete().match({ payload: subData });
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({});
});

app.post('/send-notification', async (req, res) => {
    let { senderName, title, body, imageBase64, actionType } = req.body;

    if (!title || !body) return res.status(400).json({ error: "Missing title or body" });

    try {
        title = filter.clean(title);
        body = filter.clean(body);
        senderName = filter.clean(senderName || "Admin");
    } catch (e) { console.error("Filter error:", e); }

    const finalTitle = `${senderName}: ${title}`;
    let imageUrl = "";

    // 1. Image Upload Logic
    if (imageBase64) {
        try {
            const base64Data = imageBase64.split(';base64,').pop();
            const buffer = Buffer.from(base64Data, 'base64');
            const fileName = `upload-${Date.now()}.png`;

            const { error } = await supabase.storage
                .from(BUCKET_NAME)
                .upload(fileName, buffer, { contentType: 'image/png' });

            if (error) throw error;

            const { data: publicUrlData } = supabase.storage
                .from(BUCKET_NAME)
                .getPublicUrl(fileName);
            
            imageUrl = publicUrlData.publicUrl;
            
            setTimeout(() => deleteImage(fileName), 300000); 
        } catch (err) {
            console.error("Upload Failed:", err.message);
        }
    }

    // 2. Action Buttons Logic
    let actions = [];
    if (actionType === 'yes-no') {
        actions = [
            { action: 'yes', title: '✅ Yes' },
            { action: 'no', title: '❌ No' }
        ];
    } else if (actionType === 'acknowledge') {
        actions = [
            { action: 'ok', title: '👍 Got it' }
        ];
    } else if (actionType === 'poll') {
        actions = [
            { action: 'vote-a', title: '🅰 Option A' },
            { action: 'vote-b', title: '🅱 Option B' }
        ];
    }

    const { data: subs } = await supabase.from('subscriptions').select('payload');
    
    // 3. Construct Payload
    const payloadData = { title: finalTitle, body, actions };
    if (imageUrl) payloadData.image = imageUrl;

    const notificationPayload = JSON.stringify(payloadData);

    subs.forEach(row => {
        webPush.sendNotification(row.payload, notificationPayload).catch(err => console.error(err));
    });

    res.json({ message: `Sent "${finalTitle}" to ${subs.length} users.` });
});
// --- NEW: Handle Quick Responses ---
app.post('/log-response', (req, res) => {
    const { action, replyId } = req.body;
    
    // This will show up in your Render Logs
    console.log(`\n💬 RESPONSE RECEIVED:`);
    console.log(`> Action: ${action.toUpperCase()}`);
    console.log(`> Time: ${new Date().toLocaleTimeString()}`);
    console.log(`--------------------------`);

    res.json({ success: true });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));