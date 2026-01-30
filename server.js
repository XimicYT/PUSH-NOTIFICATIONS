const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const Filter = require('bad-words');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const filter = new Filter();

app.use(cors());
app.use(bodyParser.json());

// ==========================================
// 🔧 CONFIGURATION (FILL THESE IN)
// ==========================================

// 1. VAPID KEYS (From your terminal generation)
const publicVapidKey = 'BIHGImoLhd_7pjEUpTGUNyfXuwXFf_YbqU6Sof-hY5DYwUHeKPs-ujSAkc04BPI3W_O3unmvDDi3BN1TdjjjjCA';
const privateVapidKey = 'bVU2jVGNesE-0kFCkXHOcTOOv8aBr6lek4V175JvIwI';

// 2. SUPABASE KEYS (From Supabase Dashboard -> Project Settings -> API)
// ⚠️ Use the "service_role" key (secret) so you have permission to DELETE users
const supabaseUrl = 'https://wsrnoswpyxlftrojflvr.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indzcm5vc3dweXhsZnRyb2pmbHZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTY5Nzk4MCwiZXhwIjoyMDg1MjczOTgwfQ.-xFhKtmqsTsHi0MzLp1O44j9IuxPc3ZiP96xuswSows'; 

const supabase = createClient(supabaseUrl, supabaseKey);

webpush.setVapidDetails(
  'mailto:test@test.com',
  publicVapidKey,
  privateVapidKey
);

// ==========================================
// 🚀 ROUTES
// ==========================================

// 1. Subscribe Route (Saves to Supabase)
app.post('/subscribe', async (req, res) => {
  const subscription = req.body;

  // Insert into Supabase table 'subscriptions'
  // Make sure your table has a column named 'payload' of type JSONB
  const { error } = await supabase
    .from('subscriptions')
    .insert([{ payload: subscription }]);

  if (error) {
    console.error('Error saving subscription:', error);
    res.status(500).json({ error: 'Failed to save subscription' });
  } else {
    console.log('✅ New Subscriber added to DB');
    res.status(201).json({});
  }
});

// 2. Send Notification (With 410 Cleanup)
app.post('/send-notification', async (req, res) => {
  const rawTitle = req.body.title || "New Message";
  const rawMessage = req.body.message || " ";
  const actions = req.body.actions || [];

  // Clean bad words
  const cleanTitle = filter.clean(rawTitle);
  const cleanMessage = filter.clean(rawMessage);

  const notificationPayload = JSON.stringify({
    title: cleanTitle,
    body: cleanMessage,
    actions: actions
  });

  // Fetch all subscribers from Supabase
  const { data: rows, error } = await supabase
    .from('subscriptions')
    .select('payload');

  if (error) {
    console.error('Database Error:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log(`\n📢 Sending to ${rows.length} subscribers...`);

  // Send to everyone
  const promises = rows.map((row) => {
    const subscription = row.payload;

    return webpush.sendNotification(subscription, notificationPayload)
      .catch((err) => {
        // IF USER IS GONE (410) OR NOT FOUND (404) -> DELETE THEM
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log(`💀 Cleaning up dead subscription: ${subscription.endpoint.slice(-10)}`);
          
          // Delete based on the endpoint URL inside the JSON
          return supabase
            .from('subscriptions')
            .delete()
            .eq('payload->>endpoint', subscription.endpoint);
        } else {
          console.error('Push Error:', err.statusCode);
        }
      });
  });

  await Promise.all(promises);
  res.json({ success: true });
});

// 3. Log Response (Handles Yes/No Clicks)
app.post('/log-response', (req, res) => {
    const { action } = req.body;
    console.log(`\n💬 RESPONSE RECEIVED: ${action ? action.toUpperCase() : 'UNKNOWN'}`);
    res.json({ success: true });
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));