const express = require('express');
const webPush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Filter = require('bad-words'); // Import the filter library

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- CONFIGURATION ---
const publicVapidKey = process.env.PUBLIC_VAPID_KEY;
const privateVapidKey = process.env.PRIVATE_VAPID_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);
webPush.setVapidDetails('mailto:student@example.com', publicVapidKey, privateVapidKey);

// Setup the Filter
const filter = new Filter();
// Optional: Add extra school-specific words to ban
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

// 3. SEND NOTIFICATION (With Backend Filtering)
app.post('/send-notification', async (req, res) => {
    let { title, body, image } = req.body;

    if (!title || !body) {
        return res.status(400).json({ error: "Missing title or body" });
    }

    // --- APPLY FILTER HERE ---
    // The server cleans the text before anyone sees it
    try {
        title = filter.clean(title);
        body = filter.clean(body);
        console.log(`Sending Cleaned Message: "${title}"`);
    } catch (e) {
        console.error("Filter error:", e);
    }

    const { data: subs } = await supabase.from('subscriptions').select('payload');
    
    const payloadData = { title, body };
    if (image) payloadData.image = image;

    const notificationPayload = JSON.stringify(payloadData);

    subs.forEach(row => {
        webPush.sendNotification(row.payload, notificationPayload).catch(err => console.error(err));
    });

    res.json({ message: `Sent "${title}" to ${subs.length} users.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));