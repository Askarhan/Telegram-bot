console.log('🔍 Checking environment variables:');
console.log('TOKEN exists:', !!process.env.TOKEN);
console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('CRYPTOCLOUD_API_KEY exists:', !!process.env.CRYPTOCLOUD_API_KEY);
console.log('WEBHOOK_URL:', process.env.WEBHOOK_URL);

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const axios = require('axios');

const app = express();
app.use(express.json());

// ИСПОЛЬЗУЕМ ТОЛЬКО ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const CRYPTOCLOUD_API_KEY = process.env.CRYPTOCLOUD_API_KEY;
const CRYPTOCLOUD_SHOP_ID = process.env.CRYPTOCLOUD_SHOP_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Проверка обязательных переменных
if (!TOKEN || !MONGO_URI || !CRYPTOCLOUD_API_KEY) {
    console.error('❌ Отсутствуют обязательные переменные окружения!');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN);
const client = new MongoClient(MONGO_URI);

const adminChatId = 895583535;
const waitingForAction = {};
let selectedRegion = 'RU';
let db;

// Данные алмазов
const diamondsDataRU = [
    { amount: 'Недельный алмазный пропуск', price: 217 },
    { amount: 'Сумеречный пропуск', price: 858 },
    { amount: 56, price: 124 },
    { amount: 86, price: 152 },
    { amount: 172, price: 280 },
    { amount: 257, price: 411 },
    { amount: 706, price: 1224 },
    { amount: 2195, price: 3106 },
    { amount: 3688, price: 5150 },
    { amount: 5532, price: 7708 },
    { amount: 9288, price: 12980 }
];

const diamondsDataKG = [
    { amount: 'Алмазный пропуск (w)', price: 190 },
    { amount: 'Сумеречный пропуск', price: 750 },
    { amount: 56, price: 108 },
    { amount: 86, price: 142 },
    { amount: 172, price: 264 },
    { amount: 257, price: 384 },
    { amount: 706, price: 996 },
    { amount: 2195, price: 2948 },
    { amount: 3688, price: 4900 },
    { amount: 5532, price: 7340 },
    { amount: 9288, price: 12222 }
];

// Подключение к базе данных
async function connectToDb() {
    try {
        await client.connect();
        db = client.db('bot_db');
        console.log("✅ Connected to MongoDB");
    } catch (e) {
        console.error("❌ Failed to connect to MongoDB", e);
    }
}

// Функция установки webhook
async function setWebhook() {
    try {
        const webhookUrl = `${WEBHOOK_URL}/webhook_telegram`;
        await bot.setWebHook(webhookUrl);
        console.log(`✅ Webhook установлен: ${webhookUrl}`);
    } catch (error) {
        console.error('❌ Ошибка установки webhook:', error);
    }
}

// Инициализация при запуске
async function initialize() {
    await connectToDb();
    if (WEBHOOK_URL) {
        await setWebhook();
    }
}

initialize();

// Health check endpoints
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Telegram Bot Server',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime() });
});

// Webhook для CryptoCloud платежей
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        console.log('📦 CryptoCloud webhook data:', data);
        
        if (data.status === 'success') {
            const payload = JSON.parse(data.payload || '{}');
            const userId = payload.chatId;

            const usersCollection = db.collection('users');
            const user = await usersCollection.findOne({ chatId: userId });
            let purchases = user ? user.purchases : 0;
            purchases++;

            await usersCollection.updateOne(
                { chatId: userId },
                { $set: { purchases: purchases, lastPurchase: new Date() } },
                { upsert: true }
            );

            await bot.sendMessage(userId, '✅ *Ваша оплата подтверждена!* Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!', { parse_mode: 'Markdown' });
            
            if (purchases % 5 === 0) {
                await bot.sendMessage(userId, `🎉 *Поздравляем!* 🎉 Вы совершили ${purchases} покупок и получаете бонус — *50 бонусных алмазов!*`, { parse_mode: 'Markdown' });
            }
            
            await bot.sendMessage(adminChatId, `✅ *Новая оплата через CryptoCloud!*\nПользователь: ${payload.username}\nСумма: ${data.amount} ${data.currency}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${userId}` }]
                    ]
                }
            });
        }

        res.sendStatus(200);
    } catch (e) {
        console.error('❌ Webhook error:', e);
        res.sendStatus(500);
    }
});

// Webhook для Telegram
app.post('/webhook_telegram', (req, res) => {
    try {
        console.log('📨 Telegram update received');
        bot.processUpdate(req.body);
        res.sendStatus(200);
    } catch (e) {
        console.error('❌ processUpdate error:', e);
        res.sendStatus(500);
    }
});

// Endpoint для установки webhook
app.get('/set-webhook', async (req, res) => {
    try {
        await setWebhook();
        res.json({ success: true, message: 'Webhook установлен' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Функции интерфейса
async function showMainMenu(chatId, messageId = null) {
    const menuText = 
                 '💎 *ANNUR DIAMONDS* 💎\n\n' +
       
        '• Пополнение алмазов для Mobile Legends: Bang Bang\n\n' +
        '• *Способы оплаты:*\n' +
        '• *Россия:* банковские переводы, криптовалюта\n' +
        '• *Кыргызстан:* O! Деньги, Balance.kg\n\n' +
        
        '⚡ Быстрое пополнение за 5-15 минут!';
    
    const keyboard = [
        [
            { text: '💎 Купить алмазы', callback_data: 'buy_diamonds' },
            { text: '📊 История покупок', callback_data: 'purchase_history' }
        ],
        [
            { text: '💖 Отзывы', callback_data: 'reviews' },
            { text: '📞 Поддержка', callback_data: 'support' }
        ]
    ];
    
    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    };
    
    if (messageId) {
        try {
            await bot.editMessageText(menuText, {
                chat_id: chatId,
                message_id: messageId,
                ...options
            });
        } catch (error) {
            // Если редактирование не удалось, попробуем только изменить клавиатуру
            try {
                await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } catch (secondError) {
                // Только в крайнем случае удаляем и создаем новое сообщение
                setTimeout(async () => {
                    await deleteMessage(chatId, messageId);
                    await bot.sendMessage(chatId, menuText, options);
                }, 100);
            }
        }
    } else {
        await bot.sendMessage(chatId, menuText, options);
    }
}

async function showRegionMenu(chatId, messageId = null) {
    const regionText = 
        '🌍 *Выберите ваш регион*\n\n' +
        '🇷🇺 *Россия* - переводы, криптовалюта\n' +
        '🇰🇬 *Кыргызстан* - O! Деньги, Balance.kg\n\n' +
        '💡 От региона зависят доступные способы оплаты';
    
    const keyboard = [
        [
            { text: '🇷🇺 Россия', callback_data: 'region_ru' },
            { text: '🇰🇬 Кыргызстан', callback_data: 'region_kg' }
        ],
        [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
    ];
    
    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    };
    
    if (messageId) {
        try {
            await bot.editMessageText(regionText, {
                chat_id: chatId,
                message_id: messageId,
                ...options
            });
        } catch (error) {
            try {
                await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } catch (secondError) {
                setTimeout(async () => {
                    await deleteMessage(chatId, messageId);
                    await bot.sendMessage(chatId, regionText, options);
                }, 100);
            }
        }
    } else {
        await bot.sendMessage(chatId, regionText, options);
    }
}

async function showDiamondsMenu(chatId, messageId = null) {
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

    keyboard.push([{ text: '🔙 К выбору региона', callback_data: 'back_to_regions' }]);

    const menuText = 
        `💎 *Выберите пакет алмазов*\n\n` +
        `📍 *Регион:* ${selectedRegion === 'RU' ? '🇷🇺 Россия' : '🇰🇬 Кыргызстан'}\n` +
        `💰 *Валюта:* ${currency}\n\n` +
        `Все цены указаны с учетом комиссий:`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    };

    if (messageId) {
        try {
            await bot.editMessageText(menuText, {
                chat_id: chatId,
                message_id: messageId,
                ...options
            });
        } catch (error) {
            try {
                await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } catch (secondError) {
                setTimeout(async () => {
                    await deleteMessage(chatId, messageId);
                    await bot.sendMessage(chatId, menuText, options);
                }, 100);
            }
        }
    } else {
        await bot.sendMessage(chatId, menuText, options);
    }
}

async function showPaymentMethods(chatId, orderData) {
    const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
    const selectedItem = diamondsData[orderData.index];
    const currency = orderData.region === 'RU' ? '₽' : 'KGS';
    
    let paymentButtons = [];
    
    if (orderData.region === 'KG') {
        paymentButtons = [
            [{ text: '💳 O! Деньги', callback_data: `pay_omoney_${orderData.index}` }],
            [{ text: '💰 Balance.kg', callback_data: `pay_balance_${orderData.index}` }],
            [{ text: '🏦 Банковский перевод', callback_data: `pay_transfer_${orderData.index}` }],
            [{ text: '🔙 К выбору алмазов', callback_data: 'back_to_diamonds' }]
        ];
    } else {
        paymentButtons = [
            [{ text: '🏦 Оплата переводом', callback_data: `pay_transfer_${orderData.index}` }],
            [{ text: '₿ Оплата криптовалютой', callback_data: `pay_crypto_${orderData.index}` }],
            [{ text: '🔙 К выбору алмазов', callback_data: 'back_to_diamonds' }]
        ];
    }
    
    await bot.sendMessage(chatId, 
        `💎 *Ваш заказ*\n\n` +
        `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
        `*Стоимость:* ${selectedItem.price} ${currency}\n` +
        `*Регион:* ${orderData.region === 'KG' ? '🇰🇬 Кыргызстан' : '🇷🇺 Россия'}\n\n` +
        `Выберите способ оплаты:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: paymentButtons
            }
        }
    );
}

// Показать историю покупок
async function showPurchaseHistory(chatId) {
    try {
        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна. Попробуйте позже.');
            return;
        }
        
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: chatId });
        const purchases = user ? user.purchases : 0;
        const lastPurchase = user ? user.lastPurchase : null;
        const untilBonus = 5 - (purchases % 5);
        
        let historyText = `📊 *История покупок*\n\n`;
        historyText += `👤 *Ваши покупки:* ${purchases}\n`;
        
        if (purchases === 0) {
            historyText += `💎 *Статус:* Новый клиент\n`;
            historyText += `🎁 *До первого бонуса:* ${untilBonus} покупок\n\n`;
            historyText += `🌟 Совершите 5 покупок и получите *50 бонусных алмазов*!\n\n`;
        } else {
            const bonusesReceived = Math.floor(purchases / 5);
            historyText += `🎁 *Бонусов получено:* ${bonusesReceived} (${bonusesReceived * 50} алмазов)\n`;
            
            if (untilBonus === 5) {
                historyText += `✨ *Статус:* Готов к получению бонуса!\n`;
                historyText += `🎉 *Поздравляем!* Следующая покупка принесет бонус!\n\n`;
            } else {
                historyText += `⏳ *До следующего бонуса:* ${untilBonus} покупок\n`;
            }
            
            if (lastPurchase) {
                historyText += `📅 *Последняя покупка:* ${lastPurchase.toLocaleDateString('ru-RU')}\n\n`;
            }
        }
        
        // Уровни лояльности
        let loyaltyLevel = '';
        let loyaltyEmoji = '';
        if (purchases >= 50) {
            loyaltyLevel = 'Легенда 👑';
            loyaltyEmoji = '👑';
        } else if (purchases >= 20) {
            loyaltyLevel = 'VIP клиент 💎';
            loyaltyEmoji = '💎';
        } else if (purchases >= 10) {
            loyaltyLevel = 'Постоянный клиент ⭐';
            loyaltyEmoji = '⭐';
        } else if (purchases >= 5) {
            loyaltyLevel = 'Активный покупатель 🔥';
            loyaltyEmoji = '🔥';
        } else if (purchases >= 1) {
            loyaltyLevel = 'Новичок 🌱';
            loyaltyEmoji = '🌱';
        } else {
            loyaltyLevel = 'Гость 👋';
            loyaltyEmoji = '👋';
        }
        
        historyText += `${loyaltyEmoji} *Уровень:* ${loyaltyLevel}`;
        
        await bot.sendMessage(chatId, historyText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💎 Купить алмазы', callback_data: 'buy_diamonds' }],
                    [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
                ]
            }
        });
    } catch (error) {
        console.error('❌ Error showing purchase history:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка при получении истории покупок.');
    }
}

// Инструкции для оплат
async function showTransferInstructions(chatId, messageId, orderData, index) {
    const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
    const selectedItem = diamondsData[index];
    const currency = orderData.region === 'RU' ? '₽' : 'KGS';
    
    waitingForAction[chatId].step = 'transfer_confirm';

    const paymentDetails = 
        `🏦 *Банковский перевод*\n\n` +
        `📢 *ВНИМАНИЕ!* Перевод в Кыргызстан (СНГ)\n\n` +
        `*Сумма:* ${selectedItem.price} ${currency}\n\n` +
        `*Реквизиты:*\n` +
        `👤 *Получатель:* Аскар С.\n` +
        `📱 *MBank:* +996707711770\n` +
        `💳 *Карта:* 4177490184319665\n` +
        `🏛️ *Компаньон:* +996707711770\n\n` +
        `📸 После оплаты отправьте скриншот чека`;

    const keyboard = [
        [{ text: '🔙 К способам оплаты', callback_data: 'back_to_payment' }]
    ];

    try {
        await bot.editMessageText(paymentDetails, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
                chat_id: chatId,
                message_id: messageId
            });
        } catch (secondError) {
            setTimeout(async () => {
                await deleteMessage(chatId, messageId);
                await bot.sendMessage(chatId, paymentDetails, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            }, 100);
        }
    }
}

async function showOMoneyInstructions(chatId, messageId, orderData, index) {
    const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
    const selectedItem = diamondsData[index];
    
    waitingForAction[chatId].step = 'omoney_confirm';

    const paymentDetails = 
        `💳 *O! Деньги*\n\n` +
        `*Сумма:* ${selectedItem.price} KGS\n\n` +
        `*Инструкция:*\n` +
        `1️⃣ Откройте приложение O!\n` +
        `2️⃣ Или наберите  \n` +
        `3️⃣ "Переводы" → "По номеру"\n` +
        `4️⃣ *Номер:* +996 707 711 770\n` +
        `5️⃣ *Сумма:* ${selectedItem.price} сом\n` +
        `6️⃣ *Получатель:* Аскар С.\n\n` +
        `📸 Отправьте скриншот после оплаты\n` +
        `⚡ Обработка 5-15 минут`;

    const keyboard = [
        [{ text: '🔙 К способам оплаты', callback_data: 'back_to_payment' }]
    ];

    try {
        await bot.editMessageText(paymentDetails, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
                chat_id: chatId,
                message_id: messageId
            });
        } catch (secondError) {
            setTimeout(async () => {
                await deleteMessage(chatId, messageId);
                await bot.sendMessage(chatId, paymentDetails, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            }, 100);
        }
    }
}

async function showBalanceInstructions(chatId, messageId, orderData, index) {
    const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
    const selectedItem = diamondsData[index];
    
    waitingForAction[chatId].step = 'balance_confirm';

    const paymentDetails = 
        `💰 *Balance.kg*\n\n` +
        `*Сумма:* ${selectedItem.price} KGS\n\n` +
        `*Инструкция:*\n` +
        `1️⃣ Сайт: balance.kg\n` +
        `2️⃣ Войти в кабинет\n` +
        `3️⃣ "Переводы" → "На кошелек"\n` +
        `4️⃣ *Кошелек:* +996 221 577 629\n` +
        `5️⃣ *Сумма:* ${selectedItem.price} сом\n` +
        `6️⃣ *Получатель:* Аскар С.\n\n` +
        `📸 Отправьте скриншот подтверждения`;

    const keyboard = [
        [{ text: '🔙 К способам оплаты', callback_data: 'back_to_payment' }]
    ];

    try {
        await bot.editMessageText(paymentDetails, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
                chat_id: chatId,
                message_id: messageId
            });
        } catch (secondError) {
            setTimeout(async () => {
                await deleteMessage(chatId, messageId);
                await bot.sendMessage(chatId, paymentDetails, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            }, 100);
        }
    }
}

// Функция удаления сообщения
async function deleteMessage(chatId, messageId) {
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch (error) {
        console.log('💭 Сообщение уже удалено или недоступно для удаления');
    }
}

// Команды бота
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`👤 Пользователь ${chatId} запустил бота`);
    try {
        await showMainMenu(chatId);
    } catch (error) {
        console.error('❌ Error showing main menu:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при запуске бота. Попробуйте еще раз.');
    }
});

bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    await showPurchaseHistory(chatId);
});

bot.onText(/\/mybonus/, async (msg) => {
    const chatId = msg.chat.id;
    if (!db) {
        await bot.sendMessage(chatId, 'Ошибка: база данных не подключена.');
        return;
    }
    try {
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: chatId });
        const purchases = user ? user.purchases : 0;
        const untilBonus = 5 - (purchases % 5);

        if (purchases === 0) {
            await bot.sendMessage(chatId, `У вас пока нет покупок. Совершите 5 покупок, чтобы получить бонус!`);
        } else {
            await bot.sendMessage(chatId, `Вы совершили ${purchases} покупок. Осталось ${untilBonus} до получения бонуса!`);
        }
    } catch (error) {
        console.error('❌ Database error:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при получении данных.');
    }
});

// Админские команды
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId !== adminChatId) {
        await bot.sendMessage(chatId, '❌ Доступ запрещен.');
        return;
    }
    
    try {
        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна.');
            return;
        }
        
        const usersCollection = db.collection('users');
        const ordersCollection = db.collection('orders');
        
        const totalUsers = await usersCollection.countDocuments();
        const totalOrders = await ordersCollection.countDocuments();
        const totalPurchases = await usersCollection.aggregate([
            { $group: { _id: null, total: { $sum: '$purchases' } } }
        ]).toArray();
        
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        const newUsersToday = await usersCollection.countDocuments({
            lastPurchase: { $gte: yesterday }
        });
        
        const ordersToday = await ordersCollection.countDocuments({
            created_at: { $gte: yesterday }
        });
        
        const topUsers = await usersCollection.find()
            .sort({ purchases: -1 })
            .limit(5)
            .toArray();
        
        let statsText = `📊 *СТАТИСТИКА БОТА*\n\n`;
        statsText += `👥 *Всего пользователей:* ${totalUsers}\n`;
        statsText += `📦 *Всего заказов:* ${totalOrders}\n`;
        statsText += `💎 *Всего покупок:* ${totalPurchases[0]?.total || 0}\n\n`;
        
        statsText += `📅 *За последние 24 часа:*\n`;
        statsText += `👥 Активные пользователи: ${newUsersToday}\n`;
        statsText += `📦 Новые заказы: ${ordersToday}\n\n`;
        
        statsText += `🏆 *ТОП КЛИЕНТЫ:*\n`;
        topUsers.forEach((user, index) => {
            const loyaltyEmoji = user.purchases >= 20 ? '💎' : user.purchases >= 10 ? '⭐' : '🔥';
            statsText += `${index + 1}. ${loyaltyEmoji} ${user.purchases} покупок\n`;
        });
        
        await bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('❌ Error getting stats:', error);
        await bot.sendMessage(chatId, '❌ Ошибка получения статистики.');
    }
});

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const isBotCommand = msg.text && msg.text.startsWith('/');

    if (waitingForAction[chatId] && !isBotCommand) {
        if (waitingForAction[chatId].step === 'playerId') {
            const playerId = msg.text;
            const orderData = waitingForAction[chatId];

            waitingForAction[chatId].step = 'paymentChoice';
            waitingForAction[chatId].playerId = playerId;
            
            await showPaymentMethods(chatId, waitingForAction[chatId]);

        } else if (waitingForAction[chatId].step === 'transfer_confirm' || 
                   waitingForAction[chatId].step === 'omoney_confirm' || 
                   waitingForAction[chatId].step === 'balance_confirm') {
            
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[orderData.index];
            const currency = orderData.region === 'RU' ? '₽' : 'KGS';
            const userUsername = msg.from.username;
            const userFirstName = msg.from.first_name;
            
            let paymentType = 'Банковский перевод';
            if (waitingForAction[chatId].step === 'omoney_confirm') {
                paymentType = 'O! Деньги';
            } else if (waitingForAction[chatId].step === 'balance_confirm') {
                paymentType = 'Balance.kg';
            }
            
            const adminMessage = 
                `📢 *НОВЫЙ ЗАКАЗ (${paymentType})*\n\n` +
                `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                `*Сумма:* ${selectedItem.price} ${currency}\n` +
                `*Способ оплаты:* ${paymentType}\n` +
                `*Пользователь:* ${userUsername ? `@${userUsername}` : userFirstName}\n` +
                `*ID пользователя:* ${msg.from.id}\n` +
                `*ID игрока MLBB:* ${orderData.playerId}\n` +
                `*Регион:* ${orderData.region}\n` +
                `*Ожидает подтверждения: скриншот был отправлен.*`;

            if (msg.photo) {
                await bot.sendPhoto(adminChatId, msg.photo[msg.photo.length - 1].file_id, {
                    caption: adminMessage,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Подтвердить', callback_data: `confirm_payment_${chatId}` }],
                            [{ text: '❌ Отклонить', callback_data: `decline_payment_${chatId}` }]
                        ]
                    }
                });
                
                let confirmMessage = '✅ *Ваш скриншот отправлен на проверку.*\n\n';
                if (paymentType === 'O! Деньги') {
                    confirmMessage += '📱 Проверяем платеж через O! Деньги...';
                } else if (paymentType === 'Balance.kg') {
                    confirmMessage += '💰 Проверяем платеж через Balance.kg...';
                } else {
                    confirmMessage += '🏦 Проверяем банковский перевод...';
                }
                confirmMessage += '\n\nМы сообщим вам, как только оплата будет подтверждена! ⏱️';
                
                await bot.sendMessage(chatId, confirmMessage, { parse_mode: 'Markdown' });
                delete waitingForAction[chatId];
            } else {
                await bot.sendMessage(chatId, '📷 Пожалуйста, отправьте именно *скриншот* (изображение), а не другой тип файла.\n\nНам нужно увидеть подтверждение оплаты! 🧾', { parse_mode: 'Markdown' });
            }
        }
    }
});

// Обработка callback_query
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    try {
        await bot.answerCallbackQuery(q.id);

        if (q.data === 'buy_diamonds') {
            await showRegionMenu(chatId, messageId);
            
        } else if (q.data === 'region_ru') {
            selectedRegion = 'RU';
            await showDiamondsMenu(chatId, messageId);
            
        } else if (q.data === 'region_kg') {
            selectedRegion = 'KG';
            await showDiamondsMenu(chatId, messageId);
            
        } else if (q.data === 'purchase_history') {
            await deleteMessage(chatId, messageId);
            await showPurchaseHistory(chatId);
            
        } else if (q.data === 'reviews') {
            await bot.sendMessage(chatId, '💖 Отзывы наших клиентов: https://t.me/annurreviews');
            
        } else if (q.data === 'support') {
            await bot.sendMessage(chatId, '📞 *Поддержка*\n\nПо всем вопросам обращайтесь к администратору: @annur_admin', { parse_mode: 'Markdown' });
            
        } else if (q.data === 'back_to_start') {
            await showMainMenu(chatId, messageId);
            
        } else if (q.data === 'back_to_regions') {
            await showRegionMenu(chatId, messageId);
            
        } else if (q.data === 'back_to_diamonds') {
            await showDiamondsMenu(chatId, messageId);
            
        } else if (q.data === 'back_to_payment') {
            const orderData = waitingForAction[chatId];
            if (orderData) {
                await deleteMessage(chatId, messageId);
                await showPaymentMethods(chatId, orderData);
            } else {
                await showMainMenu(chatId, messageId);
            }
            
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

            await bot.sendMessage(chatId, `Вы выбрали *${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}* за *${selectedItem.price}* ${selectedRegion === 'RU' ? '₽' : 'KGS'}.\n\nПожалуйста, отправьте мне ID своего аккаунта MLBB:`, { parse_mode: 'Markdown' });
        
        } else if (q.data.startsWith('pay_transfer_')) {
            const [, , index] = q.data.split('_');
            const orderData = waitingForAction[chatId];
            await showTransferInstructions(chatId, messageId, orderData, index);

        } else if (q.data.startsWith('pay_omoney_')) {
            const [, , index] = q.data.split('_');
            const orderData = waitingForAction[chatId];
            await showOMoneyInstructions(chatId, messageId, orderData, index);

        } else if (q.data.startsWith('pay_balance_')) {
            const [, , index] = q.data.split('_');
            const orderData = waitingForAction[chatId];
            await showBalanceInstructions(chatId, messageId, orderData, index);

        } else if (q.data.startsWith('pay_crypto_')) {
            const [, , index] = q.data.split('_');
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[index];
            
            const currency = selectedRegion === 'RU' ? 'RUB' : 'USD';
            const userFirstName = q.from.first_name;
            const userUsername = q.from.username;

            console.log('🔄 Создание CryptoCloud платежа...');

            try {
                const requestData = {
                    shop_id: CRYPTOCLOUD_SHOP_ID,
                    amount: parseFloat(selectedItem.price),
                    currency: currency,
                    order_id: `diamond_${Date.now()}_${chatId}`,
                    description: `${typeof selectedItem.amount === 'number' ? `${selectedItem.amount} алмазов` : selectedItem.amount} для MLBB`,
                    payload: JSON.stringify({
                        chatId: chatId,
                        username: userUsername || userFirstName,
                        playerId: orderData.playerId,
                        region: orderData.region,
                        itemIndex: index
                    })
                };

                const response = await axios.post('https://api.cryptocloud.plus/v2/invoice/create', requestData, {
                    headers: {
                        'Authorization': `Token ${CRYPTOCLOUD_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });

                if (response.data && response.data.result && response.data.result.link) {
                    const paymentLink = response.data.result.link;
                
                    const adminMessage =
                        `📢 *НОВЫЙ ЗАКАЗ (КРИПТО)*\n\n` +
                        `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                        `*Сумма:* ${selectedItem.price} ${currency}\n` +
                        `*Пользователь:* ${userUsername ? `@${userUsername}` : userFirstName}\n` +
                        `*ID пользователя:* ${q.from.id}\n` +
                        `*ID игрока MLBB:* ${orderData.playerId}\n` +
                        `*Регион:* ${orderData.region}`;
                
                    await bot.sendMessage(adminChatId, adminMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${q.from.id}` }]
                            ]
                        }
                    });

                    await bot.sendMessage(
                        chatId,
                        `💳 *Оплата готова!*\n\n` +
                        `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                        `*К оплате:* ${selectedItem.price} ${currency}\n\n` +
                        `Нажмите кнопку ниже для оплаты криптовалютой:`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '💳 Оплатить криптовалютой', url: paymentLink }],
                                    [{ text: '🔙 Назад', callback_data: 'back_to_diamonds' }]
                                ]
                            }
                        }
                    );

                    delete waitingForAction[chatId];

                } else {
                    throw new Error('Неправильный ответ от CryptoCloud API');
                }

            } catch (e) {
                console.error('❌ CryptoCloud API error:', e);
                
                let errorMessage = 'К сожалению, произошла ошибка при создании платежа.';
                
                if (e.response?.status === 401) {
                    errorMessage = '❌ Ошибка авторизации CryptoCloud. Проверьте API ключ.';
                } else if (e.response?.status === 400) {
                    errorMessage = '❌ Неверные параметры платежа. Попробуйте другую валюту.';
                } else if (e.response?.data?.message) {
                    errorMessage = `❌ ${e.response.data.message}`;
                }
                
                await bot.sendMessage(chatId, `${errorMessage}\n\n💡 Попробуйте:\n• Выбрать другой регион\n• Использовать оплату переводом\n• Обратиться к администратору`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Попробовать снова', callback_data: `pay_crypto_${index}` }],
                            [{ text: '💳 Оплата переводом', callback_data: `pay_transfer_${index}` }],
                            [{ text: '🔙 Назад', callback_data: 'back_to_diamonds' }]
                        ]
                    }
                });
            }
            
        } else if (q.data.startsWith('confirm_payment_')) {
            if (chatId !== adminChatId) return;
            
            const userIdToConfirm = parseInt(q.data.split('_')[2]);
            await bot.sendMessage(userIdToConfirm, `✅ *Ваша оплата подтверждена!* Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!`, { parse_mode: 'Markdown' });
            await bot.sendMessage(chatId, 'Подтверждение отправлено пользователю.');

            try {
                const usersCollection = db.collection('users');
                const user = await usersCollection.findOne({ chatId: userIdToConfirm });
                let purchases = user ? user.purchases : 0;
                purchases++;

                await usersCollection.updateOne(
                    { chatId: userIdToConfirm },
                    { $set: { purchases: purchases, lastPurchase: new Date() } },
                    { upsert: true }
                );

                if (purchases % 5 === 0) {
                    await bot.sendMessage(userIdToConfirm, `🎉 *Поздравляем!* 🎉 Вы совершили ${purchases} покупок и получаете бонус — *50 бонусных алмазов!*`, { parse_mode: 'Markdown' });
                }

                await bot.sendMessage(chatId, 'Оплата подтверждена. Теперь вы можете пополнить счет клиента и нажать "Заказ выполнен".', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${userIdToConfirm}` }]
                        ]
                    }
                });
            } catch (error) {
                console.error('❌ Database error:', error);
            }

        } else if (q.data.startsWith('decline_payment_')) {
            if (chatId !== adminChatId) return;
            
            const userIdToDecline = parseInt(q.data.split('_')[2]);
            await bot.sendMessage(userIdToDecline, '❌ *Ваша оплата отклонена.* Пожалуйста, проверьте правильность платежа и повторите попытку.', { parse_mode: 'Markdown' });
            await bot.sendMessage(chatId, 'Отказ отправлен пользователю.');
            
        } else if (q.data.startsWith('complete_order_')) {
            if (chatId !== adminChatId) return;
            
            const userIdToComplete = parseInt(q.data.split('_')[2]);
            await bot.sendMessage(userIdToComplete, `🎉 *Ваш заказ выполнен!* 🎉\n\nПожалуйста, проверьте баланс своего аккаунта в игре. Если вам все понравилось, будем рады вашему отзыву.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Оставить отзыв ❤️', url: 'https://t.me/annurreviews' }]
                    ]
                }
            });
            await bot.sendMessage(chatId, 'Сообщение о выполнении заказа отправлено пользователю.');
        }

    } catch (e) {
        console.error('❌ Callback error:', e);
        try {
            await bot.answerCallbackQuery(q.id, { text: 'Произошла ошибка. Попробуйте еще раз.' });
        } catch (answerError) {
            console.error('❌ Error answering callback:', answerError);
        }
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🔄 Получен сигнал SIGTERM. Завершение работы...');
    await client.close();
    process.exit(0);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Webhook URL: ${WEBHOOK_URL}`);
});
