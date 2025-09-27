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
const TOKEN = process.env.TOKEN; // Убрали токен из кода!
const MONGO_URI = process.env.MONGO_URI;
const CRYPTOCLOUD_API_KEY = process.env.CRYPTOCLOUD_API_KEY;
const CRYPTOCLOUD_SHOP_ID = process.env.CRYPTOCLOUD_SHOP_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://your-app.onrender.com

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

            await bot.sendMessage(userId, '✅ **Ваша оплата подтверждена!** Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!', { parse_mode: 'Markdown' });
            
            if (purchases % 5 === 0) {
                await bot.sendMessage(userId, `🎉 **Поздравляем!** 🎉 Вы совершили ${purchases} покупок и получаете бонус — **50 бонусных алмазов!**`, { parse_mode: 'Markdown' });
            }
            
            await bot.sendMessage(adminChatId, `✅ **Новая оплата через CryptoCloud!**\nПользователь: ${data.payload.username}\nСумма: ${data.amount} ${data.currency}`, {
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

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const isBotCommand = msg.text && msg.text.startsWith('/');

    if (waitingForAction[chatId] && !isBotCommand) {
        if (waitingForAction[chatId].step === 'playerId') {
            const playerId = msg.text;
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[orderData.index];
            const currency = selectedRegion === 'RU' ? '₽' : 'KGS';

            waitingForAction[chatId].step = 'paymentChoice';
            waitingForAction[chatId].playerId = playerId;
            
            // Создаем разные кнопки для разных регионов
            let paymentButtons = [];
            
            if (orderData.region === 'KG') {
                // Для Кыргызстана - местные платежные системы
                paymentButtons = [
                    [{ text: '💳 O! Деньги', callback_data: `pay_omoney_${orderData.index}` }],
                    [{ text: '💰 Balance.kg', callback_data: `pay_balance_${orderData.index}` }],
                    [{ text: '🏦 Банковский перевод', callback_data: `pay_transfer_${orderData.index}` }]
                ];
            } else {
                // Для России - крипто и переводы
                paymentButtons = [
                    [{ text: '🏦 Оплата переводом', callback_data: `pay_transfer_${orderData.index}` }],
                    [{ text: '₿ Оплата криптовалютой', callback_data: `pay_crypto_${orderData.index}` }]
                ];
            }
            
            await bot.sendMessage(chatId, 
                `Вы выбрали *${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}* ` +
                `Стоимость: *${selectedItem.price}* ${currency} 💰\n\n` +
                `${orderData.region === 'KG' ? '🇰🇬 ' : '🇷🇺 '}Выберите удобный способ оплаты:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: paymentButtons
                    }
                }
            );

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
            await editToRegionMenu(chatId, messageId);
        } else if (q.data === 'region_ru') {
            selectedRegion = 'RU';
            await editToDiamondsMenu(chatId, messageId);
        } else if (q.data === 'region_kg') {
            selectedRegion = 'KG';
            await editToDiamondsMenu(chatId, messageId);
        } else if (q.data === 'reviews') {
            await bot.sendMessage(chatId, 'Отзывы наших клиентов: https://t.me/annurreviews');
        } else if (q.data === 'leave_review') {
            await bot.sendMessage(chatId, 'Оставить отзыв вы можете в нашем канале: https://t.me/annurreviews');
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
        
        } else if (q.data.startsWith('pay_transfer_')) {
            const [, , index] = q.data.split('_');
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[index];
            const currency = selectedRegion === 'RU' ? '₽' : 'KGS';
            
            waitingForAction[chatId].step = 'transfer_confirm';

            const paymentDetails = 
                `📢 *ВНИМАНИЕ! Перевод будет выполняться в Кыргызстан (страна СНГ).*\n\n` +
                `Будьте внимательны: если оплата не пройдет по независящим от нас причинам, мы не сможем нести за это ответственность.\n` +
                `Спасибо за понимание. С любовью, ANNUR DIAMONDS 💎\n\n` +
                `*Сумма к оплате: ${selectedItem.price} ${currency}*\n\n` +
                `*Реквизиты для оплаты:*\n` +
                `*Получатель:* Аскар.С\n` +
                `*Mbank:* \\+996707711770 / 4177490184319665\n` +
                `*Банк Компаньон:* \\+996707711770 (прямой перевод по номеру телефона)\n` +
                `\nПосле оплаты отправьте скриншот чека в этот чат.`;

            await bot.sendMessage(chatId, paymentDetails, { parse_mode: 'Markdown' });

        } else if (q.data.startsWith('pay_omoney_')) {
            const [, , index] = q.data.split('_');
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[index];
            
            waitingForAction[chatId].step = 'omoney_confirm';

            const paymentDetails = 
                `💳 *O! ДЕНЬГИ - КЫРГЫЗСТАН*\n\n` +
                `*Сумма к оплате: ${selectedItem.price} KGS*\n\n` +
                `📱 *Инструкция по оплате:*\n` +
                `1. Откройте приложение O! или наберите \\*111#\n` +
                `2. Выберите "Переводы" → "По номеру телефона"\n` +
                `3. Введите номер: *\\+996 707 711 770*\n` +
                `4. Сумма: *${selectedItem.price} сом*\n` +
                `5. Получатель: *Аскар С.*\n\n` +
                `💡 *Важно:* После оплаты обязательно отправьте скриншот чека в этот чат!\n\n` +
                `🔔 Мы проверим платеж и пополним ваш аккаунт в течение 5-15 минут.`;

            await bot.sendMessage(chatId, paymentDetails, { parse_mode: 'Markdown' });

        } else if (q.data.startsWith('pay_balance_')) {
            const [, , index] = q.data.split('_');
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[index];
            
            waitingForAction[chatId].step = 'balance_confirm';

            const paymentDetails = 
                `💰 *BALANCE.KG - КЫРГЫЗСТАН*\n\n` +
                `*Сумма к оплате: ${selectedItem.price} KGS*\n\n` +
                `🌐 *Инструкция по оплате:*\n` +
                `1. Перейдите на сайт: *balance.kg*\n` +
                `2. Авторизуйтесь в личном кабинете\n` +
                `3. Выберите "Переводы" → "На кошелек"\n` +
                `4. Номер кошелька: *\\+996 707 711 770*\n` +
                `5. Сумма: *${selectedItem.price} сом*\n` +
                `6. Получатель: *Аскар С.*\n\n` +
                `💡 *Важно:* После оплаты отправьте скриншот подтверждения в этот чат!\n\n` +
                `📞 *Альтернатива:* Можете позвонить на короткий номер Balance.kg для перевода по телефону.`;

            await bot.sendMessage(chatId, paymentDetails, { parse_mode: 'Markdown' });

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
                    `📢 **НОВЫЙ ЗАКАЗ (КРИПТО)**\n\n` +
                    `**Товар:** ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                    `**Сумма:** ${selectedItem.price} ${currency}\n` +
                    `**Пользователь:** ${userUsername ? `@${userUsername}` : userFirstName}\n` +
                    `**ID пользователя:** ${q.from.id}\n` +
                    `**ID игрока MLBB:** ${orderData.playerId}\n` +
                    `**Регион:** ${orderData.region}`;
                
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
                    `💳 **Оплата готова!**\n\n` +
                    `**Товар:** ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                    `**К оплате:** ${selectedItem.price} ${currency}\n\n` +
                    `Нажмите кнопку ниже для оплаты криптовалютой:`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '💳 Оплатить криптовалютой', url: paymentLink }],
                                [{ text: '🔙 Назад', callback_data: 'back_to_regions' }]
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
                } else if (e.response?.data?.message) {
                    errorMessage = `❌ ${e.response.data.message}`;
                }
                
                await bot.sendMessage(chatId, `${errorMessage}\n\n💡 Попробуйте:\n• Выбрать другой регион\n• Использовать оплату переводом\n• Обратиться к администратору`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Попробовать снова', callback_data: `pay_crypto_${index}` }],
                            [{ text: '💳 Оплата переводом', callback_data: `pay_transfer_${index}` }],
                            [{ text: '🔙 Назад', callback_data: 'back_to_regions' }]
                        ]
                    }
                });
            }
            
        } else if (q.data.startsWith('confirm_payment_')) {
            const userIdToConfirm = parseInt(q.data.split('_')[2]);
            await bot.sendMessage(userIdToConfirm, `✅ **Ваша оплата подтверждена!** Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!`, { parse_mode: 'Markdown' });
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
                    await bot.sendMessage(userIdToConfirm, `🎉 **Поздравляем!** 🎉 Вы совершили ${purchases} покупок и получаете бонус — **50 бонусных алмазов!**`, { parse_mode: 'Markdown' });
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
            const userIdToDecline = parseInt(q.data.split('_')[2]);
            await bot.sendMessage(userIdToDecline, '❌ **Ваша оплата отклонена.** Пожалуйста, проверьте правильность платежа и повторите попытку.', { parse_mode: 'Markdown' });
            await bot.sendMessage(chatId, 'Отказ отправлен пользователю.');
            
        } else if (q.data.startsWith('complete_order_')) {
            const userIdToComplete = parseInt(q.data.split('_')[2]);
            await bot.sendMessage(userIdToComplete, `🎉 **Ваш заказ выполнен!** 🎉\n\nПожалуйста, проверьте баланс своего аккаунта в игре. Если вам все понравилось, будем рады вашему отзыву.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Оставить отзыв ❤️', url: 'https://t.me/annurreviews' }]
                    ]
                }
            });
            await bot.sendMessage(chatId, 'Сообщение о выполнении заказа отправлено пользователю.');
        }

        await bot.answerCallbackQuery(q.id);
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

async function showMainMenu(chatId) {
    try {
        await bot.sendMessage(chatId, 
            '💎 *ANNUR DIAMONDS* 💎\n\n' +
            '🎮 Пополнение алмазов для Mobile Legends: Bang Bang\n\n' +
            '💳 *Способы оплаты:*\n' +
            '🇷🇺 *Россия:* банковские переводы, криптовалюта\n' +
            '🇰🇬 *Кыргызстан:* O! Деньги, Balance.kg\n\n' +
            '⚡ Быстрое пополнение за 5-15 минут!', 
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '💎 Купить алмазы', callback_data: 'buy_diamonds' },
                            { text: '💖 Отзывы', url: 'https://t.me/annurreviews' }
                        ],
                        [{ text: '💌 Оставить отзыв', url: 'https://t.me/annurreviews' }]
                    ]
                }
            });
    } catch (error) {
        console.error('❌ Error showing main menu:', error);
    }
}

async function editToRegionMenu(chatId, messageId) {
    try {
        await bot.editMessageText(
            '🌍 *Выберите ваш регион для оплаты:*\n\n' +
            '🇷🇺 *Россия* - банковские переводы, криптовалюта\n' +
            '🇰🇬 *Кыргызстан* - O! Деньги, Balance.kg, банк. переводы', 
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🇷🇺 Россия (RU)', callback_data: 'region_ru' },
                            { text: '🇰🇬 Кыргызстан (KG)', callback_data: 'region_kg' }
                        ],
                        [{ text: '🔙 Назад', callback_data: 'back_to_start' }]
                    ],
                },
            });
    } catch (error) {
        console.error('❌ Error editing to region menu:', error);
    }
}

async function editToDiamondsMenu(chatId, messageId) {
    try {
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
    } catch (error) {
        console.error('❌ Error editing to diamonds menu:', error);
    }
}

async function editToMainMenu(chatId, messageId) {
    try {
        await bot.editMessageText('Главное меню:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Купить алмазы 💎', callback_data: 'buy_diamonds' },
                        { text: 'Отзывы 💖', url: 'https://t.me/annurreviews' }
                    ],
                    [{ text: 'Оставить отзыв 💌', url: 'https://t.me/annurreviews' }]
                ]
            }
        });
    } catch (error) {
        console.error('❌ Error editing to main menu:', error);
    }
}

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Webhook URL: ${WEBHOOK_URL}`);
});