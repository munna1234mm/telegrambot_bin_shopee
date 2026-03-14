require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Telegram Bot
const botToken = process.env.BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;
const bot = new TelegramBot(botToken, { polling: true });

// Initialize Firebase
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc } = require('firebase/firestore/lite');

const firebaseConfig = {
    apiKey: "AIzaSyA98AqgNgh67RBCuxh6ee_j0Lh5udTMHj0",
    authDomain: "binshopeetips.firebaseapp.com",
    projectId: "binshopeetips",
    storageBucket: "binshopeetips.firebasestorage.app",
    messagingSenderId: "431904094355",
    appId: "1:431904094355:web:68796fa94c3f4ebd5af566",
    measurementId: "G-Q2Y2QWR2EC"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);


// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Explicit route for the Mini App homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Explicit route for the Admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// In-memory store for verification codes (for production, use a database or Redis)
const verificationCodes = new Map();

// Helper to generate a 6-digit code
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Bot /start handling
bot.onText(/\/start(?:\s+(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const referrerId = match[1];
    const firstName = msg.from.first_name || 'Unknown';
    const lastName = msg.from.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim();

    let photoUrl = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(fullName) + '&background=random';

    // Try to get user profile photo
    try {
        const photos = await bot.getUserProfilePhotos(chatId, { limit: 1 });
        if (photos && photos.total_count > 0) {
            // Get the highest resolution photo (last in the array of sizes)
            const photoSizes = photos.photos[0];
            const bestPhoto = photoSizes[photoSizes.length - 1];

            // Get the file path
            photoUrl = await bot.getFileLink(bestPhoto.file_id);
        }
    } catch (error) {
        console.error('Error fetching profile photo:', error.message);
    }

    // Save to Firebase and handle Referral
    try {
        const userRef = doc(db, "users", chatId.toString());
        const userSnap = await getDoc(userRef);
        const isNewUser = !userSnap.exists();
        
        await setDoc(userRef, {
            chatId: chatId,
            name: fullName,
            photoUrl: photoUrl,
            verified: false,
            balance: isNewUser ? 0 : (userSnap.data().balance || 0),
            lastActive: new Date().toISOString()
        }, { merge: true });

        // Process referral if new user and referrer exists
        if (isNewUser && referrerId && referrerId !== chatId.toString()) {
            const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
            const bonus = settingsSnap.exists() ? (settingsSnap.data().referralBonus || 0) : 0;
            
            if (bonus > 0) {
                const referrerRef = doc(db, 'users', referrerId.toString());
                const referrerSnap = await getDoc(referrerRef);
                if (referrerSnap.exists()) {
                    const newBalance = (referrerSnap.data().balance || 0) + bonus;
                    await setDoc(referrerRef, { balance: newBalance }, { merge: true });
                    bot.sendMessage(referrerId, `🎉 You referred a friend! You have earned ${bonus} USDT.`);
                    
                    // Also give starting bonus to new user? Not requested, so skipping.
                }
            }
        }
    } catch (error) {
        console.error('Error saving user to Firebase:', error.message);
    }

    bot.sendMessage(chatId, `Welcome, ${firstName}!\nYour Chat ID is: ${chatId}\nPlease use this ID in the Mini App to verify your account.`);
});

// API endpoint to request a verification code
app.post('/api/send-code', async (req, res) => {
    const { chatId } = req.body;

    if (!chatId) {
        return res.status(400).json({ success: false, message: 'Chat ID is required' });
    }

    try {
        const code = generateCode();
        // Save code with 5 mins expiration
        verificationCodes.set(chatId.toString(), {
            code,
            expires: Date.now() + 5 * 60 * 1000
        });

        await bot.sendMessage(chatId, `Your verification code for bin shopee Mini App is: ${code}\nThis code will expire in 5 minutes.`);

        res.json({ success: true, message: 'Code sent to your Telegram' });
    } catch (error) {
        console.error('Error sending message:', error.message);
        res.status(500).json({ success: false, message: 'Failed to send code via Telegram. Make sure the bot is started and Chat ID is correct.' });
    }
});

// API endpoint to verify the code
app.post('/api/verify-code', async (req, res) => {
    const { chatId, code } = req.body;

    if (!chatId || !code) {
        return res.status(400).json({ success: false, message: 'Chat ID and code are required' });
    }

    const storedData = verificationCodes.get(chatId.toString());

    if (!storedData) {
        return res.status(400).json({ success: false, message: 'No verification code requested or it has expired' });
    }

    if (Date.now() > storedData.expires) {
        verificationCodes.delete(chatId.toString());
        return res.status(400).json({ success: false, message: 'Verification code has expired' });
    }

    if (storedData.code === code.trim()) {
        // Code is correct
        verificationCodes.delete(chatId.toString());

        try {
            // Mark user as verified in Firebase
            const userRef = doc(db, "users", chatId.toString());
            await setDoc(userRef, { verified: true }, { merge: true });

            // Getting full user info to send to frontend
            let userData = { name: "User", photoUrl: "", balance: 0 };
            try {
                const userSnap = await getDoc(userRef);
                if (userSnap.exists()) {
                    userData = userSnap.data();
                }
            } catch (e) {
                console.error("Failed to read user from Firebase:", e.message);
            }

            // Fallback: If Firebase failed or user data wasn't saved, fetch directly from Telegram
            if (!userData.photoUrl || userData.name === "User") {
                try {
                    const chatInfo = await bot.getChat(chatId);
                    const firstName = chatInfo.first_name || 'User';
                    const lastName = chatInfo.last_name || '';
                    userData.name = `${firstName} ${lastName}`.trim();

                    const photos = await bot.getUserProfilePhotos(chatId, { limit: 1 });
                    if (photos && photos.total_count > 0) {
                        const photoSizes = photos.photos[0];
                        const bestPhoto = photoSizes[photoSizes.length - 1];
                        userData.photoUrl = await bot.getFileLink(bestPhoto.file_id);
                    } else {
                        userData.photoUrl = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(userData.name) + '&background=random';
                    }

                    // Save this fetched data back into Firebase permanently!
                    try {
                        await setDoc(userRef, {
                            chatId: chatId,
                            name: userData.name,
                            photoUrl: userData.photoUrl,
                            lastActive: new Date().toISOString()
                        }, { merge: true });
                        console.log("Successfully retroactively saved missing user data to Firebase!");
                    } catch (fbErr) {
                        console.error('Retroactive Firebase save failed. Is database enabled?', fbErr.message);
                    }
                } catch (fallbackErr) {
                    console.error('Fallback Telegram fetch failed:', fallbackErr.message);
                }
            }

            // Let admin know someone verified (optional)
            bot.sendMessage(adminChatId, `User ${userData.name || chatId} has successfully verified via Mini App.`);

            res.json({
                success: true,
                message: 'Verification successful',
                userId: chatId,
                name: userData.name,
                photoUrl: userData.photoUrl,
                balance: userData.balance || 0
            });
        } catch (error) {
            console.error('Firebase verification update error:', error);
            res.json({ success: true, message: 'Verified (Storage Error)', userId: chatId });
        }
    } else {
        res.status(400).json({ success: false, message: 'Invalid verification code' });
    }
});

// API endpoint for admin to get all users
app.get('/api/admin/users', async (req, res) => {
    try {
        const usersCol = collection(db, 'users');
        const userSnapshot = await getDocs(usersCol);
        const usersList = userSnapshot.docs.map(doc => doc.data());
        res.json({ success: true, users: usersList });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

// API endpoint for admin to add an item/update
app.post('/api/admin/items', async (req, res) => {
    const { name, price, description, copyBtnText, copyBtnValue, imageUrl } = req.body;
    
    if (!name || !price) {
        return res.status(400).json({ success: false, message: 'Name and price are required' });
    }

    try {
        const newItemRef = doc(collection(db, 'items'));
        await setDoc(newItemRef, {
            name,
            price: parseFloat(price),
            description: description || '',
            copyBtnText: copyBtnText || '',
            copyBtnValue: copyBtnValue || '',
            imageUrl: imageUrl || '',
            createdAt: new Date().toISOString()
        });
        res.json({ success: true, message: 'Product added successfully' });
    } catch (error) {
        console.error('Error adding item:', error);
        res.status(500).json({ success: false, message: 'Failed to add item' });
    }
});

app.put('/api/admin/items/:id', async (req, res) => {
    const { id } = req.params;
    const { name, price, description, copyBtnText, copyBtnValue, imageUrl } = req.body;
    
    try {
        const itemRef = doc(db, 'items', id);
        let updateData = {
            name,
            price: parseFloat(price),
            description: description || '',
            copyBtnText: copyBtnText || '',
            copyBtnValue: copyBtnValue || '',
            updatedAt: new Date().toISOString()
        };
        if (imageUrl) updateData.imageUrl = imageUrl;

        await setDoc(itemRef, updateData, { merge: true });
        res.json({ success: true, message: 'Product updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update item' });
    }
});

app.delete('/api/admin/items/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await deleteDoc(doc(db, 'items', id));
        res.json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete item' });
    }
});

app.get('/api/admin/settings', async (req, res) => {
    try {
        const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
        let settings = settingsSnap.exists() ? settingsSnap.data() : { referralBonus: 0 };
        res.json({ success: true, settings });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch settings' });
    }
});

app.post('/api/admin/settings', async (req, res) => {
    const { referralBonus } = req.body;
    try {
        await setDoc(doc(db, 'settings', 'global'), { referralBonus: parseFloat(referralBonus || 0) }, { merge: true });
        res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});

// API endpoint to fetch items for users
app.get('/api/items', async (req, res) => {
    try {
        const itemsCol = collection(db, 'items');
        const itemSnapshot = await getDocs(itemsCol);
        // Include doc ID back to UI
        const itemsList = itemSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, items: itemsList });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch items' });
    }
});

// Start Express Server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
