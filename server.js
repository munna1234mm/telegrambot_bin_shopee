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

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for verification codes (for production, use a database or Redis)
const verificationCodes = new Map();

// Helper to generate a 6-digit code
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Bot /start handling
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Welcome to bin shopee bot!\nYour Chat ID is: ${chatId}\nPlease use this ID in the Mini App to verify your account.`);
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
app.post('/api/verify-code', (req, res) => {
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
        
        // Let admin know someone verified (optional)
        bot.sendMessage(adminChatId, `User ${chatId} has successfully verified via Mini App.`);

        res.json({ success: true, message: 'Verification successful', userId: chatId });
    } else {
        res.status(400).json({ success: false, message: 'Invalid verification code' });
    }
});

// Start Express Server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
