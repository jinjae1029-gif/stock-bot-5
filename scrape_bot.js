import puppeteer from 'puppeteer';
import TelegramBot from 'node-telegram-bot-api';
import admin from 'firebase-admin';

// --- CONFIGURATION ---
const TARGET_URL = 'https://jinjae1029-gif.github.io/stock-bot-5/';
const BOT_ID = 'stock-bot-5';
const TG_TOKEN = process.env.TG_TOKEN;
const FIREBASE_CREDENTIALS = process.env.FIREBASE_CREDENTIALS;

let db = null;

if (FIREBASE_CREDENTIALS) {
    try {
        const serviceAccount = JSON.parse(FIREBASE_CREDENTIALS);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
    } catch (e) {
        console.error("Firebase Init Error:", e.message);
    }
}

async function getChatId(userId) {
    if (!db) return null;
    try {
        const doc = await db.collection('users').doc(userId).get();
        if (doc.exists) {
            const data = doc.data();
            return data.telegramChatId || data.tgChatId;
        }
    } catch (e) {
        console.error("Error fetching user:", e);
    }
    return null;
}

async function sendTelegram(chatId, text) {
    if (!TG_TOKEN || !chatId) {
        console.log("⚠️ Missing Token or Chat ID");
        return;
    }
    const bot = new TelegramBot(TG_TOKEN);
    try {
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        console.log(`Sent to ${chatId}`);
    } catch (e) {
        console.error("TG Error:", e.message);
    }
}

(async () => {
    console.log("🚀 Starting Scraper Bot (Bot 5)...");

    // 1. Get Chat ID
    const chatId = await getChatId(BOT_ID);
    if (!chatId) {
        console.error("❌ Could not find Chat ID for", BOT_ID);
        process.exit(1);
    }
    console.log(`Target: ${BOT_ID} (Chat: ${chatId})`);

    // 2. Launch Browser
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        // 3. Go to Page
        console.log(`Navigating to ${TARGET_URL}...`);
        await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });

        // 4. Set LocalStorage (Simulate User)
        await page.evaluate((uid) => {
            localStorage.setItem('firebaseUserId', uid);
        }, BOT_ID);

        // 5. Reload to apply ID and Load Data
        console.log("Reloading with User ID...");
        await page.reload({ waitUntil: 'networkidle0' });

        // 6. Wait for "Total Asset" to confirm logic ran
        console.log("Waiting for simulation...");
        await page.waitForFunction(() => {
            const el = document.getElementById('totalAsset');
            return el && el.innerText.includes('$');
        }, { timeout: 30000 });

        // 7. Ensure "Trading Sheet" Mode (Toggle ON)
        const toggle = await page.$('#toggleMode');
        if (toggle) {
            const isChecked = await (await toggle.getProperty('checked')).jsonValue();
            if (!isChecked) {
                console.log("Switching to Trading Sheet Mode...");
                await toggle.click();
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // 8. Open Order Sheet Modal
        console.log("Opening Order Sheet...");
        await page.click('#btnOrderSheet');

        await page.waitForSelector('#orderSheetModal', { visible: true, timeout: 5000 });

        // 9. Scrape Content
        const rawText = await page.$eval('#orderSheetModal .modal-content', el => el.innerText);

        const cleanText = rawText
            .replace('주문표 (Order Sheet)', '📅 <b>주문표 (Bot 5 Scraped)</b>')
            .replace('닫기', '')
            .replace('텍스트 복사', '')
            .trim();

        console.log("--- SCRAPED TEXT ---");
        console.log(cleanText);
        console.log("--------------------");

        // 10. Send
        await sendTelegram(chatId, cleanText);

    } catch (e) {
        console.error("Scraping Error:", e);
    } finally {
        await browser.close();
        process.exit(0);
    }
})();
