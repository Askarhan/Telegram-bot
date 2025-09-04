const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const PORT = process.env.PORT;
const TOKEN = process.env.TOKEN || '8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w';
const MONGO_URI = process.env.MONGO_URI;

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

app.get('/', (req, res) => {
    res.send('Сервер работает!');
});

app.post('/webhook', (req, res) => {
    try {
        bot.processUpdate(req.body);
    } catch (e) {
        console.error('processUpdate error:', e);
    }
    res.sendStatus(200);
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    showMainMenu(chatId);
});

bot.onText(/\/mybonus/, async (msg) => {
    const chatId = msg.chat.id;
    if (!db) {
        await bot.sendMessage(chatId, 'Ошибка: база данных не подключена.');
        return;
    }
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ chatId: chatId });
    const purchases = user ? user.purchases : 0;
    const untilBonus = 5 - (purchases % 5);

    if (purchases === 0) {
        await bot.sendMessage(chatId, `У вас пока нет покупок. Совершите 5 покупок, чтобы получить бонус!`);
    } else {
        await bot.sendMessage(chatId, `Вы совершили ${purchases} покупок. Осталось ${untilBonus} до получения бонуса!`);
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (waitingForAction[chatId]) {
        if (waitingForAction[chatId].step === 'playerId') {
            const playerId = msg.text;
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[orderData.index];
            const currency = orderData.region === 'RU' ? '₽' : 'KGS';

            const adminMessage =
                `📢 **НОВЫЙ ЗАКАЗ**\n\n` +
                `**Товар:** ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                `**Сумма:** ${selectedItem.price} ${currency}\n` +
                `**Пользователь:** ${msg.from.username ? `@${msg.from.username}` : msg.from.first_name}\n` +
                `**ID пользователя:** ${msg.from.id}\n` +
                `**ID игрока MLBB:** ${playerId}`;
            
            await bot.sendMessage(adminChatId, adminMessage, { parse_mode: 'Markdown' });

            const userMessageText =
                `К оплате ${selectedItem.price} ${currency}.\n\n` +
                `**Переведите средства на:**\n` +
                `[ВАШИ РЕКВИЗИТЫ]\n\n` +
                `*После оплаты нажмите "Я оплатил ✅".*`;
            
            await bot.sendMessage(
                chatId,
                userMessageText,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Я оплатил ✅', callback_data: `paid` }],
                            [{ text: 'Назад', callback_data: 'back_to_regions' }]
                        ]
                    }
                }
            );

            delete waitingForAction[chatId];
        } else if (waitingForAction[chatId].step === 'screenshot' && msg.photo) {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            const userId = msg.from.id;
            const userFirstName = msg.from.first_name;

            const adminMessage =
                `❗️ **ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ**\n\n` +
                `**Пользователь:** ${userFirstName}\n` +
                `**ID пользователя:** ${userId}\n` +
                `**Действие:** Проверить оплату по скриншоту.`

            await bot.sendPhoto(adminChatId, photoId, {
                caption: adminMessage,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Подтвердить оплату', callback_data: `confirm_payment_${userId}` },
                            { text: '❌ Отклонить оплату', callback_data: `decline_payment_${userId}` }
                        ]
                    ]
                }
            });

            await bot.sendMessage(
                chatId,
                'Спасибо! Ваш скриншот отправлен на проверку. Пожалуйста, ожидайте подтверждения.'
            );

            waitingForAction[chatId] = { step: 'waiting_for_admin_approval' };
        }
    }
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    try {
        if (q.data.startsWith('confirm_payment_')) {
            const userId = parseInt(q.data.split('_')[2]);
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
            
            await bot.editMessageText(`✅ **Оплата подтверждена.**\n\nПользователь: ${q.from.username || q.from.first_name}\n\nСчётчик покупок обновлён в базе данных.`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            });
            delete waitingForAction[userId];


        } else if (q.data.startsWith('decline_payment_')) {
            const userId = parseInt(q.data.split('_')[2]);

            const userMessageText =
                `❌ **Извините, ваша оплата не прошла.**` +
                `\n\nУбедитесь в действительности вашей транзакции.` +
                `\nЕсли все правильно, и вы перевели деньги по правильному реквизиту, нажмите кнопку ниже:`;
            
            await bot.sendMessage(userId, userMessageText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Проверить снова', callback_data: `resend_screenshot_${userId}` }]
                    ]
                }
            });
            
            await bot.editMessageText(`❌ **Оплата отклонена.**\n\nПользователь: ${q.from.username || q.from.first_name}`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            });
            delete waitingForAction[userId];

        } else if (q.data.startsWith('resend_screenshot_')) {
            const userId = parseInt(q.data.split('_')[2]);

            if (waitingForAction[userId] && waitingForAction[userId].step === 'waiting_for_admin_approval') {
                await bot.sendMessage(userId, 'Подождите, ваш платеж в процессе одобрения.', { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(userId, 'Пожалуйста, **пришлите скриншот** вашей оплаты ещё раз.');
                waitingForAction[userId] = { step: 'screenshot' };
            }
        } else if (q.data === 'buy_diamonds') {
            await editToRegionMenu(chatId, messageId);
        } else if (q.data === 'region_ru') {
            selectedRegion = 'RU';
            await editToDiamondsMenu(chatId, messageId);
        } else if (q.data === 'region_kg') {
            selectedRegion = 'KG';
            await editToDiamondsMenu(chatId, messageId);
        } else if (q.data === 'reviews') {
            await bot.sendMessage(chatId, 'Отзывы наших клиентов: https://t.me/ТВОЙ_КАНАЛ');
        } else if (q.data === 'leave_review') {
            await bot.sendMessage(chatId, 'Оставить отзыв: @ТВОЙ_НИК');
        } else if (q.data === 'back_to_start') {
            await editToMainMenu(chatId, messageId);
        } else if (q.data === 'back_to_regions') {
            await editToRegionMenu(chatId, messageId);
        } else if (q.data.startsWith('diamond_')) {
            const selectedItemIndex = q.data.split('_')[1];
            const diamondsData = selectedRegion === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[selectedItemIndex];

            waitingForAction[chatId] = {
                step: 'playerId',
                index: selectedItemIndex,
                region: selectedRegion,
                item: selectedItem
            };

            await bot.sendMessage(chatId, `Вы выбрали **${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}** за **${selectedItem.price}** ${selectedRegion === 'RU' ? '₽' : 'KGS'}. Пожалуйста, отправьте мне ID своего аккаунта MLBB:`, { parse_mode: 'Markdown' });
        } else if (q.data === 'paid') {
            const userFirstName = q.from.first_name;
            await bot.sendMessage(chatId, `Спасибо, ${userFirstName}! Теперь, пожалуйста, **пришлите скриншот** вашей оплаты.`);
            waitingForAction[chatId] = { step: 'screenshot' };
        }
        await bot.answerCallbackQuery(q.id);
    } catch (e) {
        console.error('callback error:', e);
    }
});

async function showMainMenu(chatId) {
    await bot.sendMessage(chatId, 'Главное меню:', {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Купить алмазы 💎', callback_data: 'buy_diamonds' },
                    { text: 'Отзывы 💖', callback_data: 'reviews' }
                ],
                [{ text: 'Оставить отзыв 💌', callback_data: 'leave_review' }]
            ]
        }
    });
}

async function editToRegionMenu(chatId, messageId) {
    await bot.editMessageText('Выберите регион:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🇷🇺 RU', callback_data: 'region_ru' },
                    { text: '🇰🇬 KG', callback_data: 'region_kg' }
                ],
                [{ text: 'Назад 🔙', callback_data: 'back_to_start' }]
            ],
        },
    });
}

async function editToDiamondsMenu(chatId, messageId) {
    const currency = selectedRegion === 'RU' ? '₽' : 'KGS';
    const diamondsData = selectedRegion === 'RU' ? diamondsDataRU : diamondsDataKG;
    const keyboard = [];
    let currentRow = [];

    diamondsData.forEach((d, index) => {
        const amountText = typeof d.amount === 'number' ? `${d.amount}💎` : d.amount;
        
        currentRow.push({
            text: `${amountText} — ${d.price.toLocaleString('ru-RU')} ${currency}`,
            callback_data: `diamond_${index}`
        });

        if (currentRow.length === 2 || index === diamondsData.length - 1) {
            keyboard.push(currentRow);
            currentRow = [];
        }
    });

    keyboard.push([{ text: 'Назад 🔙', callback_data: 'back_to_regions' }]);

    await bot.editMessageText(`Выберите пакет алмазов (сейчас выбран регион: ${selectedRegion}):`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard },
    });
}

async function editToMainMenu(chatId, messageId) {
    await bot.editMessageText('Главное меню:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Купить алмазы 💎', callback_data: 'buy_diamonds' },
                    { text: 'Отзывы 💖', callback_data: 'reviews' }
                ],
                [{ text: 'Оставить отзыв 💌', callback_data: 'leave_review' }]
            ]
        }
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
