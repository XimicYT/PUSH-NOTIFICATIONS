const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const Filter = require('bad-words'); // Import the filter

const app = express();
const filter = new Filter(); // Initialize it

app.use(cors());
app.use(bodyParser.json());

// Replace these with your generated VAPID keys
const publicVapidKey = 'YOUR_PUBLIC_KEY_HERE';
const privateVapidKey = 'YOUR_PRIVATE_KEY_HERE';

webpush.setVapidDetails(
  'mailto:test@test.com',
  publicVapidKey,
  privateVapidKey
);

// Store subscriptions in memory (Note: This wipes when server restarts)
let subscriptions = [];

// 1. Subscribe Route
app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  subscriptions.push(subscription);
  res.status(201).json({});
  console.log("New Subscriber!");
});

// 2. Send Notification Route (FIXED)
app.post('/send-notification', (req, res) => {
    // SECURITY FIX: Ensure we have strings, default to space if empty
    const rawTitle = req.body.title || "New Message";
    const rawMessage = req.body.message || " "; 

    // Clean the text
    const cleanTitle = filter.clean(rawTitle);
    const cleanMessage = filter.clean(rawMessage);
    const cleanImage = req.body.image || null;
    const actions = req.body.actions || [];

    const payload = JSON.stringify({ 
        title: cleanTitle, 
        body: cleanMessage,
        image: cleanImage,
        actions: actions
    });

    console.log(`Sending: ${cleanTitle} - ${cleanMessage}`);

    // Loop through all subscribers
    const promises = subscriptions.map((sub, index) => {
        return webpush.sendNotification(sub, payload)
            .catch(err => {
                if (err.statusCode === 410) {
                    // 410 means the user blocked us or cleared data.
                    console.log(`Endpoint expired/unsubscribed. removing...`);
                    // Ideally, remove from array here (simple version doesn't, to avoid index errors during loop)
                    return; 
                }
                console.error("Push Error:", err.statusCode);
            });
    });

    Promise.all(promises).then(() => res.json({ success: true }));
});

// 3. Log Responses (The Yes/No Click Handler)
app.post('/log-response', (req, res) => {
    const { action } = req.body;
    console.log(`\n💬 USER CLICKED: ${action ? action.toUpperCase() : "Unknown"}`);
    res.json({ success: true });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));