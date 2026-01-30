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

function safeClean(text) {
    if (!text) return ""; 
    try { return filter.clean(String(text)); } 
    catch (e) { return String(text); }
}

// 1. SUBSCRIBE: Now saves the 'name'
app.post('/subscribe', async (req, res) => {
    const { subscription, name } = req.body;
    
    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: "Invalid subscription data" });
    }

    // Clean up old sub for this device
    await supabase.from('subscriptions').delete().filter('payload->>endpoint', 'eq', subscription.endpoint);

    // Insert new sub WITH name
    // Ensure you ran the SQL: ALTER TABLE subscriptions ADD COLUMN name TEXT;
    const { error } = await supabase.from('subscriptions').insert({ 
        payload: subscription,
        name: safeClean(name) 
    });
    
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({});
});

app.post('/unsubscribe', async (req, res) => {
    const subData = req.body;
    if (!subData || !subData.endpoint) return res.status(400).json({});
    await supabase.from('subscriptions').delete().filter('payload->>endpoint', 'eq', subData.endpoint);
    res.status(200).json({});
});

// 2. NEW ENDPOINT: Get list of subscribers for the Admin dropdown
app.get('/subscribers', async (req, res) => {
    const { data, error } = await supabase.from('subscriptions').select('id, name');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// 3. SEND: Now accepts optional 'targetId'
app.post('/send-notification', async (req, res) => {
    let { senderName, title, body, imageBase64, targetId } = req.body;

    if (!title || !body) return res.status(400).json({ error: "Missing title or body" });

    title = safeClean(title);
    body = safeClean(body);
    senderName = safeClean(senderName || "Admin");

    const finalTitle = `${senderName}: ${title}`;
    let imageUrl = "";

    // Image Upload Logic (Same as before)
    if (imageBase64) {
        try {
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            const fileName = `upload-${Date.now()}.png`;
            const { error } = await supabase.storage.from(BUCKET_NAME).upload(fileName, buffer, { contentType: 'image/png' });
            if (!error) {
                const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(fileName);
                imageUrl = data.publicUrl;
                // setTimeout(() => deleteImage(fileName), 300000); // Optional cleanup
            }
        } catch (err) { console.error("Upload failed", err); }
    }

    // QUERY LOGIC: Filter by ID if targetId is provided
    let query = supabase.from('subscriptions').select('payload');
    
    if (targetId && targetId !== 'all') {
        query = query.eq('id', targetId);
    }

    const { data: subs, error } = await query;

    if (error || !subs || subs.length === 0) {
        return res.json({ message: "No recipients found." });
    }

    const notificationPayload = JSON.stringify({ 
        title: finalTitle, 
        body: body, 
        image: imageUrl 
    });

    // Send messages
    const sendPromises = subs.map(row => {
        if (!row.payload) return Promise.resolve();
        return webPush.sendNotification(row.payload, notificationPayload)
            .catch(err => {
                if (err.statusCode === 410 || err.statusCode === 404) {
                   supabase.from('subscriptions').delete().filter('payload->>endpoint', 'eq', row.payload.endpoint);
                }
            });
    });

    await Promise.all(sendPromises);
    res.json({ message: `Sent to ${subs.length} device(s).` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));