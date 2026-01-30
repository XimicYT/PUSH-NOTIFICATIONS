const express = require('express');
const webPush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Filter = require('bad-words'); 

const app = express();
app.use(cors());

// INCREASE LIMIT for image uploads (Standard limit is too small for images)
app.use(bodyParser.json({ limit: '10mb' })); 

// --- CONFIGURATION ---
const publicVapidKey = process.env.PUBLIC_VAPID_KEY;
const privateVapidKey = process.env.PRIVATE_VAPID_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);
webPush.setVapidDetails('mailto:student@example.com', publicVapidKey, privateVapidKey);

const filter = new Filter();
filter.addWords('sucks', 'freaking', 'poop'); 

// 1. SUBSCRIBE
app.post('/subscribe', async (req, res) => {
    const subData = req.body;
    await supabase.from('subscriptions').delete().match({ payload: subData });
    const { error } = await supabase.from('subscriptions').insert({ payload: subData });
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({});
});

// 2. UNSUBSCRIBE
app.post('/unsubscribe', async (req, res) => {
    const subData = req.body;
    const { error } = await supabase.from('subscriptions').delete().match({ payload: subData });
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({});
});

// 3. SEND NOTIFICATION (With Image Upload)
app.post('/send-notification', async (req, res) => {
    let { title, body, imageBase64 } = req.body;

    if (!title || !body) return res.status(400).json({ error: "Missing title or body" });

    // A. Clean Text
    try {
        title = filter.clean(title);
        body = filter.clean(body);
    } catch (e) { console.error("Filter error:", e); }

    // B. Handle Image Upload (if exists)
    let imageUrl = "";
    if (imageBase64) {
        try {
            // 1. Remove the "data:image/png;base64," header
            const base64Data = imageBase64.split(';base64,').pop();
            const buffer = Buffer.from(base64Data, 'base64');
            const fileName = `upload-${Date.now()}.png`;

            // 2. Upload to Supabase Storage
            const { data, error } = await supabase.storage
                .from('notifications') // Ensure this bucket exists in Supabase!
                .upload(fileName, buffer, { contentType: 'image/png' });

            if (error) throw error;

            // 3. Get Public URL
            const { data: publicUrlData } = supabase.storage
                .from('notifications')
                .getPublicUrl(fileName);
            
            imageUrl = publicUrlData.publicUrl;
            console.log("Image uploaded:", imageUrl);
        } catch (err) {
            console.error("Upload Failed:", err.message);
            // We continue sending the text notification even if image fails
        }
    }

    // C. Send Push
    const { data: subs } = await supabase.from('subscriptions').select('payload');
    const payloadData = { title, body };
    if (imageUrl) payloadData.image = imageUrl;

    const notificationPayload = JSON.stringify(payloadData);

    subs.forEach(row => {
        webPush.sendNotification(row.payload, notificationPayload).catch(err => console.error(err));
    });

    res.json({ message: `Sent "${title}" to ${subs.length} users.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));