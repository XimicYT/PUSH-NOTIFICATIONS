const express = require('express');
const webPush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Filter = require('bad-words'); 

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); 

// --- CONFIGURATION ---
const publicVapidKey = process.env.PUBLIC_VAPID_KEY;
const privateVapidKey = process.env.PRIVATE_VAPID_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const BUCKET_NAME = 'notifications'; // Verify this matches your Supabase bucket name

const supabase = createClient(supabaseUrl, supabaseKey);
webPush.setVapidDetails('mailto:student@example.com', publicVapidKey, privateVapidKey);

const filter = new Filter();
filter.addWords('sucks', 'freaking', 'poop'); 

// --- CLEANUP HELPER ---
// Deletes a specific file from Supabase
async function deleteImage(fileName) {
    console.log(`🗑️ Attempting to auto-delete: ${fileName}...`);
    const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([fileName]);
    
    if (error) {
        console.error("❌ Failed to delete image:", error.message);
    } else {
        console.log("✅ Image deleted successfully.");
    }
}

// --- OPTIONAL: CLEANUP ON STARTUP ---
// If the server restarts, this clears out old junk so you don't waste storage.
async function cleanOldFiles() {
    console.log("🧹 Server starting: Checking for old images to clean...");
    const { data: files, error } = await supabase.storage.from(BUCKET_NAME).list();
    if (files && files.length > 0) {
        // Simple strategy: Delete EVERYTHING in the bucket on restart
        // (Since images are temporary anyway)
        const fileNames = files.map(f => f.name);
        await supabase.storage.from(BUCKET_NAME).remove(fileNames);
        console.log(`🧹 Cleaned up ${fileNames.length} old images from storage.`);
    }
}
// Run cleanup immediately when server starts
cleanOldFiles();


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

// 3. SEND NOTIFICATION
// 3. SEND NOTIFICATION
app.post('/send-notification', async (req, res) => {
    let { title, body, imageBase64 } = req.body;

    if (!title || !body) return res.status(400).json({ error: "Missing title or body" });

    // Filter Profanity
    try {
        title = filter.clean(title);
        body = filter.clean(body);
    } catch (e) { console.error("Filter error:", e); }

    let imageUrl = "";

    // Handle Image Upload
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
            
            // --- DEBUG LOG IN RENDER ---
            console.log("--------------------------------");
            console.log("📸 GENERATED URL:", imageUrl);
            console.log("--------------------------------");

            // Auto-delete timer (5 mins)
            setTimeout(() => deleteImage(fileName), 300000); 

        } catch (err) {
            console.error("Upload Failed:", err.message);
        }
    }

    const { data: subs } = await supabase.from('subscriptions').select('payload');
    
    // --- CRITICAL: Construct Payload ---
    const payloadData = { title, body };
    if (imageUrl) {
        payloadData.image = imageUrl; // This adds the "image" key
    }

    // --- DEBUG LOG IN RENDER ---
    const notificationPayload = JSON.stringify(payloadData);
    console.log("🚀 SENDING PAYLOAD:", notificationPayload);

    subs.forEach(row => {
        webPush.sendNotification(row.payload, notificationPayload).catch(err => console.error(err));
    });

    res.json({ message: `Sent. URL: ${imageUrl ? "YES" : "NO"}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));