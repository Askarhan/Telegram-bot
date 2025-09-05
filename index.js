const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT;
const TOKEN = process.env.TOKEN || '8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w';
const MONGO_URI = process.env.MONGO_URI;

const CRYPTOCLOUD_API_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiTmprMk5URT0iLCJ0eXBlIjoicHJvamVjdCIsInYiOiI4YTFlZTY2NzU3YmZiNGJmMzk2NWZiOTQyM2ZjZTI2N2I3MTllMjEyNWZkMmJjNWMzNWExMTNkMTcyZThlMWU5IiwiZXhwIjo4ODE1NjkyODU5NX0.tupMgUWPHW4a1mvdb0oarSMln4P7AFRGxbBJtorHaxw';
const CRYPTOCLOUD_SHOP_ID = '6Pi76JVyHST5yALH';

const bot = new TelegramBot(TOKEN);
const client = new MongoClient(MONGO_URI);

const adminChatId = 895583535;

const waitingForAction = {};
let selectedRegion = 'RU';
let db;

async function connectToDb() {
    try {
        await client.connect();
        db = client.db('bot_db');
        console.log("Connected to MongoDB");
    } catch (e) {
        console.error("Failed to connect to MongoDB", e);
    }
}

connectToDb();

const diamondsDataRU = [
    { amount: 56, price: 124 },
    { amount: 86, price: 152 },
    { amount: 172, price: 280 },
    { amount: 257, price: 411 },
    { amount: 706, price: 1224 },
    { amount: 2195, price: 3105 },
    { amount: 3688, price: 4292 },
    { amount: 5532, price: 6342 },
    { amount: 9288, price: 10700 }
];

const diamondsDataKG = [
    { amount: 'Алмазный пропуск (w)', price: 181 },
    { amount: 'Сумеречный пропуск', price: 715 },
    { amount: 56, price: 104 },
    { amount: 86, price: 127 },
    { amount: 172, price: 234 },
    { amount: 257, price: 343 },
    { amount: 706, price: 874 },
    { amount: 2195, price: 2588 },
    { amount: 3688, price: 4292 },
    { amount: 5532, price: 6342 },
    { amount: 9288, price: 10700 }
];

app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        if (data.status === 'success') {
            const userId = data.payload.chatId;

            const usersCollection = db.collection('users');
            const user = await usersCollection.findOne({ chatId: userId });
            let purchases = user ? user.purchases : 0;
            purchases++;

            await usersCollection.updateOne(
                { chatId: userId },
                { $set: { purchases: purchases, lastPurchase: new Date() } },
                { upsert: true }
            );

            await bot.sendMessage(userId, '✅ **Ваша оплата подтверждена!** Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!', { parse_mode: 'Markdown' });
            
            if (purchases % 5 === 0) {
                await bot.sendMessage(userId, `🎉 **Поздравляем!** 🎉 Вы совершили ${purchases} покупок и получаете бонус — **50 бонусных алмазов!**`, { parse_mode: 'Markdown' });
            }
            
            await bot.sendMessage(adminChatId, `✅ **Новая оплата через CryptoCloud!**\nПользователь: ${data.payload.username}\nСумма: ${data.amount} ${data.currency}`);
        }

        res.sendStatus(200);
    } catch (e) {
        console.error('Webhook error:', e);
        res.sendStatus(500);
    }
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;

    if (q.data.startsWith('pay_crypto_')) {
        const [, , index] = q.data.split('_');
        const orderData = waitingForAction[chatId];
        const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
        const selectedItem = diamondsData[index];
        const currency = selectedRegion === 'RU' ? 'RUB' : 'KGS';

        const userFirstName = q.from.first_name;
        const userUsername = q.from.username;

        try {
            const response = await axios.post('https://api.cryptocloud.plus/v1/invoice/create', {
                shop_id: CRYPTOCLOUD_SHOP_ID,
                amount: selectedItem.price,
                currency: currency,
                order_id: `order_${Date.now()}_${chatId}`,
                payload: {
                    chatId: chatId,
                    username: userUsername || userFirstName,
                    playerId: orderData.playerId,
                    item: `${selectedItem.amount} ${currency}`
                }
            }, {
                headers: {
                    'Authorization': `Token ${CRYPTOCLOUD_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const paymentLink = response.data.result.link;

            await bot.sendMessage(
                chatId,
                `К оплате **${selectedItem.price} ${currency}**.\n\n` +
                `Оплата криптовалютой через CryptoCloud.`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Оплатить ✅', url: paymentLink }],
                            [{ text: 'Назад', callback_data: 'back_to_regions' }]
                        ]
                    }
                }
            );
        } catch (e) {
            console.error('CryptoCloud API error:', e.response ? e.response.data : e.message);
            await bot.sendMessage(chatId, 'К сожалению, произошла ошибка при создании платежа. Попробуйте еще раз.');
        }
    }

    await bot.answerCallbackQuery(q.id);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
