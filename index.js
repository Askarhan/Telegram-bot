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

async function connectToDb() {
    try {
        await client.connect();
        db = client.db('bot_db');
        console.log("✅ Connected to MongoDB");
    } catch (e) {
        console.error("❌ Failed to connect to MongoDB", e);
    }
}

// ВАЖНО: Функция установки webhook
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
    { amount: 5532, price: 7470 },
    { amount: 9288, price: 12980 }
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

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Telegram Bot Server',
        timestamp: new Date().toISOString()
    });
});

// Health check для UptimeRobot
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime() });
});

// Webhook для CryptoCloud платежей
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        console.log('📦 CryptoCloud webhook data:', data);
        
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

            await bot.sendMessage(userId, '✅ *Ваша оплата подтверждена!* Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!', { parse_mode: 'Markdown' });
            
            if (purchases % 5 === 0) {
                await bot.sendMessage(userId, `🎉 *Поздравляем!* 🎉 Вы совершили ${purchases} покупок и получаете бонус — *50 бонусных алмазов!*`, { parse_mode: 'Markdown' });
            }
            
            await bot.sendMessage(adminChatId, `✅ *Новая оплата через CryptoCloud!*\nПользователь: ${data.payload.username}\nСумма: ${data.amount} ${data.currency}`, {
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

// Endpoint для установки webhook (одноразово)
app.get('/set-webhook', async (req, res) => {
    try {
        await setWebhook();
        res.json({ success: true, message: 'Webhook установлен' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    console.log(`👤 Пользователь ${chatId} запустил бота`);
    showMainMenu(chatId);
});

// Добавляем команду для истории покупок
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

// Команда для получения статистики (только для админа)
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
        
        // Общая статистика
        const totalUsers = await usersCollection.countDocuments();
        const totalOrders = await ordersCollection.countDocuments();
        const totalPurchases = await usersCollection.aggregate([
            { $group: { _id: null, total: { $sum: '$purchases' } } }
        ]).toArray();
        
        // Статистика за последние 24 часа
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        const newUsersToday = await usersCollection.countDocuments({
            lastPurchase: { $gte: yesterday }
        });
        
        const ordersToday = await ordersCollection.countDocuments({
            created_at: { $gte: yesterday }
        });
        
        // Топ пользователи
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

// Команда для рассылки (только для админа)
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const message = match[1];
    
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
        const users = await usersCollection.find({}).toArray();
        
        let successCount = 0;
        let errorCount = 0;
        
        await bot.sendMessage(chatId, `📤 Начинаю рассылку для ${users.length} пользователей...`);
        
        for (const user of users) {
            try {
                await bot.sendMessage(user.chatId, `📢 *ОБЪЯВЛЕНИЕ*\n\n${message}`, { parse_mode: 'Markdown' });
                successCount++;
                
                // Небольшая пауза чтобы не превысить лимиты API
                await new Promise(resolve => setTimeout(resolve, 50));
                
            } catch (error) {
                errorCount++;
                console.log(`❌ Не удалось отправить сообщение пользователю ${user.chatId}`);
            }
        }
        
        await bot.sendMessage(chatId, 
            `📊 *Рассылка завершена*\n\n` +
            `✅ Успешно: ${successCount}\n` +
            `❌ Ошибок: ${errorCount}`, 
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        console.error('❌ Error in broadcast:', error);
        await bot.sendMessage(chatId, '❌ Ошибка рассылки.');
    }
});

// Команда для поиска пользователя (только для админа)
bot.onText(/\/user (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const targetUserId = parseInt(match[1]);
    
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
        
        const user = await usersCollection.findOne({ chatId: targetUserId });
        
        if (!user) {
            await bot.sendMessage(chatId, '❌ Пользователь не найден в базе данных.');
            return;
        }
        
        const userOrders = await ordersCollection.find({ user_id: targetUserId }).toArray();
        
        let userInfo = `👤 *ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ*\n\n`;
        userInfo += `🆔 *ID:* ${targetUserId}\n`;
        userInfo += `💎 *Покупки:* ${user.purchases || 0}\n`;
        userInfo += `📅 *Последняя покупка:* ${user.lastPurchase ? user.lastPurchase.toLocaleDateString('ru-RU') : 'Никогда'}\n`;
        userInfo += `📦 *Заказов в базе:* ${userOrders.length}\n\n`;
        
        if (userOrders.length > 0) {
            userInfo += `📋 *ПОСЛЕДНИЕ ЗАКАЗЫ:*\n`;
            userOrders.slice(-3).forEach((order, index) => {
                userInfo += `${index + 1}. ${order.products} - ${order.total_price}₽ (${order.status})\n`;
            });
        }
        
        const bonusesReceived = Math.floor((user.purchases || 0) / 5);
        userInfo += `\n🎁 *Бонусов получено:* ${bonusesReceived}`;
        
        await bot.sendMessage(chatId, userInfo, { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎁 Выдать бонус', callback_data: `give_bonus_${targetUserId}` }],
                    [{ text: '📞 Написать пользователю', callback_data: `contact_user_${targetUserId}` }]
                ]
            }
        });
        
    } catch (error) {
        console.error('❌ Error getting user info:', error);
        await bot.sendMessage(chatId, '❌ Ошибка получения информации о пользователе.');
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const isBotCommand = msg.text && msg.text.startsWith('/');

    if (waitingForAction[chatId] && !isBotCommand) {
        if (waitingForAction[chatId].step === 'playerId') {
            const playerId = msg.text;
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[orderData.index];

            waitingForAction[chatId].step = 'paymentChoice';
            waitingForAction[chatId].playerId = playerId;
            
            // Показываем способы оплаты через отдельную функцию
            await showPaymentMethods(chatId, waitingForAction[chatId]);

        } else if (waitingForAction[chatId].step === 'transfer_confirm' || 
                   waitingForAction[chatId].step === 'omoney_confirm' || 
                   waitingForAction[chatId].step === 'balance_confirm') {
            
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[orderData.index];
            const currency = selectedRegion === 'RU' ? '₽' : 'KGS';
            const userUsername = msg.from.username;
            const userFirstName = msg.from.first_name;
            
            // Определяем тип оплаты для админа
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

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    try {
        if (q.data === 'buy_diamonds') {
            await deleteMessage(chatId, messageId);
            await showRegionMenu(chatId);
        } else if (q.data === 'region_ru') {
            selectedRegion = 'RU';
            await editToDiamondsMenu(chatId, messageId);
        } else if (q.data === 'region_kg') {
            selectedRegion = 'KG';
            await editToDiamondsMenu(chatId, messageId);
        } else if (q.data === 'purchase_history') {
            await deleteMessage(chatId, messageId);
            await showPurchaseHistory(chatId);
        } else if (q.data === 'reviews') {
            await bot.sendMessage(chatId, '💖 Отзывы наших клиентов: https://t.me/annurreviews');
        } else if (q.data === 'back_to_start') {
            await deleteMessage(chatId, messageId);
            await showMainMenu(chatId);
        } else if (q.data === 'back_to_regions') {
            await deleteMessage(chatId, messageId);
            await showRegionMenu(chatId);
        } else if (q.data === 'back_to_diamonds') {
            await deleteMessage(chatId, messageId);
            await showDiamondsMenu(chatId);
        } else if (q.data === 'back_to_payment') {
            // Возвращаемся к выбору способа оплаты
            const orderData = waitingForAction[chatId];
            if (orderData) {
                await deleteMessage(chatId, messageId);
                await showPaymentMethods(chatId, orderData);
            } else {
                await editToMainMenu(chatId, messageId);
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
            
            // Исправляем валюты для CryptoCloud
            const currency = selectedRegion === 'RU' ? 'RUB' : 'USD'; // KGS не поддерживается, используем USD
            const userFirstName = q.from.first_name;
            const userUsername = q.from.username;

            console.log('🔄 Создание CryptoCloud платежа...');
            console.log('Shop ID:', CRYPTOCLOUD_SHOP_ID);
            console.log('Amount:', selectedItem.price);
            console.log('Currency:', currency);

            try {
                // Правильная структура запроса для CryptoCloud API v2
                const requestData = {
                    shop_id: CRYPTOCLOUD_SHOP_ID,
                    amount: parseFloat(selectedItem.price), // Убеждаемся что это число
                    currency: currency,
                    order_id: `diamond_${Date.now()}_${chatId}`, // Уникальный ID
                    description: `${typeof selectedItem.amount === 'number' ? `${selectedItem.amount} алмазов` : selectedItem.amount} для MLBB`,
                    payload: JSON.stringify({
                        chatId: chatId,
                        username: userUsername || userFirstName,
                        playerId: orderData.playerId,
                        region: orderData.region,
                        itemIndex: index
                    })
                };

                console.log('📦 Request data:', JSON.stringify(requestData, null, 2));

                const response = await axios.post('https://api.cryptocloud.plus/v2/invoice/create', requestData, {
                    headers: {
                        'Authorization': `Token ${CRYPTOCLOUD_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000 // 10 секунд таймаут
                });

                console.log('✅ CryptoCloud response:', response.data);

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
                                [{ text: '🔙 Назад', callback_data: 'back_to_payment' }]
                            ]
                        }
                    }
                );

                delete waitingForAction[chatId]; // Очищаем состояние после создания платежа

                } else {
                    throw new Error('Неправильный ответ от CryptoCloud API');
                }

            } catch (e) {
                console.error('❌ CryptoCloud API error details:');
                console.error('Status:', e.response?.status);
                console.error('Status Text:', e.response?.statusText);
                console.error('Headers:', e.response?.headers);
                console.error('Data:', e.response?.data);
                console.error('Message:', e.message);
                
                let errorMessage = 'К сожалению, произошла ошибка при создании платежа.';
                
                if (e.response?.status === 401) {
                    errorMessage = '❌ Ошибка авторизации CryptoCloud. Проверьте API ключ.';
                    console.error('🔑 Проверьте CRYPTOCLOUD_API_KEY в переменных окружения');
                } else if (e.response?.status === 400) {
                    errorMessage = '❌ Неверные параметры платежа. Попробуйте другую валюту.';
                    console.error('💰 Возможно проблема с валютой или суммой');
