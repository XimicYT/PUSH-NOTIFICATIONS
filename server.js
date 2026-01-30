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

// --- HELPER: Safe Clean ---
// Prevents "Cannot read properties of null" crashes
function safeClean(text) {
    if (!text) return ""; 
    try {
        return filter.clean(String(text)); // Force to string
    } catch (e) {
        console.error("Filter failed on input, returning raw:", e);
        return String(text);
    }
}

async function deleteImage(fileName) {
    await supabase.storage.from(BUCKET_NAME).remove([fileName]);
}

async function cleanOldFiles() {
    console.log("🧹 Cleaning old images...");
    // Pass empty string '' to list root folder
    const { data: files, error } = await supabase.storage.from(BUCKET_NAME).list('');
    
    if (error) {
        console.error("Error listing files:", error.message);
        return;
    }

    if (files && files.length > 0) {
        const fileNames = files.map(f => f.name);
        await supabase.storage.from(BUCKET_NAME).remove(fileNames);
        console.log(`Deleted ${fileNames.length} old temp files.`);
    }
}
cleanOldFiles();

app.post('/subscribe', async (req, res) => {
    const subData = req.body;
    
    if (!subData || !subData.endpoint) {
        return res.status(400).json({ error: "Invalid subscription data" });
    }

    // 1. Remove ANY existing subscription with this endpoint to prevent duplicates
    // Using payload->>endpoint JSON filtering
    const { error: delError } = await supabase
        .from('subscriptions')
        .delete()
        .filter('payload->>endpoint', 'eq', subData.endpoint);

    if (delError) console.error("Cleanup error:", delError.message);

    // 2. Insert the new subscription
    const { error } = await supabase.from('subscriptions').insert({ payload: subData });
    
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({});
});

app.post('/unsubscribe', async (req, res) => {
    const subData = req.body;
    if (!subData || !subData.endpoint) return res.status(400).json({});

    // Delete by endpoint for reliability
    const { error } = await supabase
        .from('subscriptions')
        .delete()
        .filter('payload->>endpoint', 'eq', subData.endpoint);

    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({});
});

app.post('/send-notification', async (req, res) => {
    let { senderName, title, body, imageBase64 } = req.body;

    if (!title || !body) return res.status(400).json({ error: "Missing title or body" });

    // --- SECURE FILTERING ---
    title = safeClean(title);
    body = safeClean(body);
    senderName = safeClean(senderName || "Admin");
    // ------------------------

    const finalTitle = `${senderName}: ${title}`;
    let imageUrl = "";

    if (imageBase64) {
        try {
            // Remove header if present (data:image/png;base64,...)
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
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
            
            // Delete image after 5 minutes
            setTimeout(() => deleteImage(fileName), 300000); 
        } catch (err) {
            console.error("Upload Failed:", err.message);
            // We continue sending the text notification even if image fails
        }
    }

    // Fetch Subscriptions
    const { data: subs, error } = await supabase.from('subscriptions').select('payload');

    if (error) {
        console.error("DB Error:", error.message);
        return res.status(500).json({ error: "Database error fetching subscribers" });
    }

    if (!subs || subs.length === 0) {
        return res.json({ message: "No subscribers found." });
    }

    // Construct final payload
    const payloadData = { title: finalTitle, body };
    if (imageUrl) payloadData.image = imageUrl;
    const notificationPayload = JSON.stringify(payloadData);

    // Send to all (parallel)
    let successCount = 0;
    const sendPromises = subs.map(row => {
        // Validation: row.payload must exist
        if (!row.payload) return Promise.resolve();

        return webPush.sendNotification(row.payload, notificationPayload)
            .then(() => { successCount++; })
            .catch(async (err) => {
                // If 410 (Gone) or 404, the subscription is dead. Clean it up.
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.log(`Removing dead subscription: ${row.payload.endpoint}`);
                    await supabase
                        .from('subscriptions')
                        .delete()
                        .filter('payload->>endpoint', 'eq', row.payload.endpoint);
                } else {
                    console.error("Push Error:", err.statusCode);
                }
            });
    });

    await Promise.all(sendPromises);

    res.json({ message: `Sent "${finalTitle}" to ${successCount} users.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));