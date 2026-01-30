const express = require('express');
const webPush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

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

// 1. SUBSCRIBE
app.post('/subscribe', async (req, res) => {
    const subData = req.body;
    // Delete if exists first to avoid duplicates
    await supabase.from('subscriptions').delete().match({ payload: subData });
    
    const { error } = await supabase.from('subscriptions').insert({ payload: subData });
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({});
});

// 2. UNSUBSCRIBE (New!)
app.post('/unsubscribe', async (req, res) => {
    const subData = req.body;
    // Find the user with this specific subscription info and delete them
    const { error } = await supabase.from('subscriptions').delete().match({ payload: subData });
    
    if (error) return res.status(500).json({ error: error.message });
    console.log("User unsubscribed");
    res.status(200).json({});
});

// 3. MANUAL TEST BLAST (New!)
app.post('/broadcast-test', async (req, res) => {
    const { data: subs } = await supabase.from('subscriptions').select('payload');
    const notificationPayload = JSON.stringify({ 
        title: 'Test Message', 
        body: 'This is a test sent from the dashboard!' 
    });

    subs.forEach(row => {
        webPush.sendNotification(row.payload, notificationPayload).catch(err => console.error(err));
    });

    res.json({ message: `Sent test to ${subs.length} users.` });
});

// 4. CRON JOB TRIGGER (Keep this safe!)
app.get('/trigger-push', async (req, res) => {
    if (req.query.secret !== process.env.TRIGGER_SECRET) return res.status(401).send('Unauthorized');
    
    const { data: subs } = await supabase.from('subscriptions').select('payload');
    const notificationPayload = JSON.stringify({ 
        title: 'School Reminder', 
        body: 'It is 3:20 PM! Time to pack up.' 
    });

    subs.forEach(row => {
        webPush.sendNotification(row.payload, notificationPayload).catch(err => console.error(err));
    });

    res.send(`Triggered for ${subs.length} users.`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));