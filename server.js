const express = require('express');
const webPush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- SETUP VARIABLES (We get these from Render settings) ---
const publicVapidKey = process.env.PUBLIC_VAPID_KEY;
const privateVapidKey = process.env.PRIVATE_VAPID_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // This must be the SERVICE_ROLE key

// Initialize Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize Web-Push
webPush.setVapidDetails('mailto:student@example.com', publicVapidKey, privateVapidKey);

// --- ROUTE 1: Subscribe User ---
app.post('/subscribe', async (req, res) => {
    const subData = req.body;

    // Save to Supabase
    const { error } = await supabase
        .from('subscriptions')
        .insert({ payload: subData });

    if (error) {
        console.error('Error saving sub:', error);
        return res.status(500).json({ error: error.message });
    }

    console.log('New subscriber saved!');
    res.status(201).json({});
});

// --- ROUTE 2: Trigger Notification (3:20 PM) ---
app.get('/trigger-push', async (req, res) => {
    // Security check
    if (req.query.secret !== process.env.TRIGGER_SECRET) {
        return res.status(401).send('Unauthorized');
    }

    // 1. Get all subscribers from Supabase
    const { data: subs, error } = await supabase
        .from('subscriptions')
        .select('payload');

    if (error) return res.status(500).send(error.message);

    console.log(`Sending to ${subs.length} people...`);
    const notificationPayload = JSON.stringify({ 
        title: 'School Reminder', 
        body: 'It is 3:20 PM! Time to pack up.' 
    });

    // 2. Send to everyone
    subs.forEach(row => {
        const subscription = row.payload;
        webPush.sendNotification(subscription, notificationPayload)
            .catch(err => console.error("Failed to send to one user:", err));
    });

    res.send(`Attempted to send to ${subs.length} users.`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));