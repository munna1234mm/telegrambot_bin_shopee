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
        if (isNewUser && referrerId) {
            const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
            const bonus = settingsSnap.exists() ? (settingsSnap.data().referralBonus || 0) : 0;
            
            if (bonus > 0) {
                // Find referrer by referralCode
                const usersCol = collection(db, 'users');
                const userSnapshot = await getDocs(usersCol);
                let referrerDoc = null;
                
                userSnapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    if(data.referralCode === referrerId || docSnap.id === referrerId) {
                        referrerDoc = docSnap;
                    }
                });

                if (referrerDoc) {
                    const referrerData = referrerDoc.data();
                    const referrerRef = doc(db, 'users', referrerDoc.id);
                    
                    const newBalance = (referrerData.balance || 0) + bonus;
                    const newTotalReferred = (referrerData.totalReferred || 0) + 1;
                    const newEarnings = (referrerData.referralEarnings || 0) + bonus;
                    
                    await setDoc(referrerRef, { 
                        balance: newBalance,
                        totalReferred: newTotalReferred,
                        referralEarnings: newEarnings
                    }, { merge: true });
                    
                    const refSuccessHtml = `🎊 <b>Referral Success!</b> 🎊

A new user just joined using your referral link!
You have been credited: <b>+${bonus} USDT</b> 💰

<i>Keep inviting friends to earn more!</i>`;
                    bot.sendMessage(referrerDoc.id, refSuccessHtml, { parse_mode: 'HTML' });
                }
            }
        }
    } catch (error) {
        console.error('Error saving user to Firebase:', error.message);
    }

    const welcomeHtml = `🎉 <b>Welcome to Bin Shopee, ${firstName}!</b> 🎉

Your secure Telegram Chat ID is:
<code>${chatId}</code>

<i>💡 Please copy this ID and use it in the Mini App to verify your account and start earning!</i>`;

    bot.sendMessage(chatId, welcomeHtml, { parse_mode: 'HTML' });
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

        const codeHtml = `🔐 <b>Verification Required</b>

Your secure login code for Bin Shopee is:
<code>${code}</code>

<i>⏱ This code will expire in exactly 5 minutes. Do not share it!</i>`;

        await bot.sendMessage(chatId, codeHtml, { parse_mode: 'HTML' });

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
            let userData = { name: "User", photoUrl: "", balance: 0, referralCode: "", totalReferred: 0, referralEarnings: 0 };
            let isNewUser = false;
            
            try {
                const userSnap = await getDoc(userRef);
                if (userSnap.exists()) {
                    userData = userSnap.data();
                    if(!userData.verified) isNewUser = true; // First time verifying
                } else {
                    isNewUser = true;
                }
            } catch (e) {
                console.error("Failed to read user from Firebase:", e.message);
                isNewUser = true;
            }

            // Generate a referral code if they don't have one
            if (!userData.referralCode) {
                userData.referralCode = 'BNS-' + Math.random().toString(36).substring(2, 8).toUpperCase();
            }
            if(userData.totalReferred === undefined) userData.totalReferred = 0;
            if(userData.referralEarnings === undefined) userData.referralEarnings = 0;

            await setDoc(userRef, { 
                verified: true,
                referralCode: userData.referralCode,
                totalReferred: userData.totalReferred,
                referralEarnings: userData.referralEarnings
            }, { merge: true });

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
                            referralCode: userData.referralCode,
                            totalReferred: userData.totalReferred,
                            referralEarnings: userData.referralEarnings,
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

            // Process Referral if new user and referrerCode provided
            const referrerCode = req.body.referrerCode;
            if (isNewUser && referrerCode && referrerCode !== userData.referralCode) {
                try {
                    const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
                    const bonus = settingsSnap.exists() ? (settingsSnap.data().referralBonus || 0) : 0;
                    
                    if (bonus > 0) {
                        // Find the referrer by referralCode
                        const usersCol = collection(db, 'users');
                        const userSnapshot = await getDocs(usersCol);
                        let referrerDoc = null;
                        
                        userSnapshot.forEach(docSnap => {
                            if(docSnap.data().referralCode === referrerCode) {
                                referrerDoc = docSnap;
                            }
                        });
                        
                        if (referrerDoc) {
                            const referrerData = referrerDoc.data();
                            const referrerRef = doc(db, 'users', referrerDoc.id);
                            
                            const newBalance = (referrerData.balance || 0) + bonus;
                            const newTotalReferred = (referrerData.totalReferred || 0) + 1;
                            const newEarnings = (referrerData.referralEarnings || 0) + bonus;
                            
                            await setDoc(referrerRef, { 
                                balance: newBalance,
                                totalReferred: newTotalReferred,
                                referralEarnings: newEarnings
                            }, { merge: true });
                            
                            try {
                                bot.sendMessage(referrerDoc.id, `🎉 **Referral Success!**\nSomeone joined using your Mini App referral link.\nYou have been credited ${bonus} USDT.`);
                            } catch(e) {}
                        }
                    }
                } catch(err) {
                    console.error('Error processing referral:', err);
                }
            }

            res.json({
                success: true,
                message: 'Verification successful',
                userId: chatId,
                name: userData.name,
                photoUrl: userData.photoUrl,
                balance: userData.balance || 0,
                referralCode: userData.referralCode,
                totalReferred: userData.totalReferred,
                referralEarnings: userData.referralEarnings
            });
        } catch (error) {
            console.error('Firebase verification update error:', error);
            res.json({ success: true, message: 'Verified (Storage Error)', userId: chatId });
        }
    } else {
        res.status(400).json({ success: false, message: 'Invalid verification code' });
    }
});

// API endpoint to fetch a single user's up-to-date stats
app.get('/api/user/:chatId', async (req, res) => {
    try {
        const userRef = doc(db, "users", req.params.chatId.toString());
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            res.json({ success: true, user: userSnap.data() });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch user' });
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
