// Полная улучшенная версия Telegram-бота для продажи алмазов MLBB
// Версия 2.0 с реферальной системой, промокодами и улучшенной безопасностью

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const axios = require('axios');

// Импорт модулей
const { DIAMONDS_DATA_RU, DIAMONDS_DATA_KG, LOYALTY_LEVELS, EMOJIS, LIMITS } = require('./config/constants');
const logger = require('./utils/logger');
const Validators = require('./utils/validators');
const ReferralService = require('./services/referralService');
const PromoService = require('./services/promoService');
const BotHandlers = require('./handlers/botHandlers');

console.log('🔍 Checking environment variables:');
console.log('TOKEN exists:', !!process.env.TOKEN);
console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('CRYPTOCLOUD_API_KEY exists:', !!process.env.CRYPTOCLOUD_API_KEY);
console.log('WEBHOOK_URL:', process.env.WEBHOOK_URL);

const app = express();
app.use(express.json());

// Переменные окружения
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const CRYPTOCLOUD_API_KEY = process.env.CRYPTOCLOUD_API_KEY;
const CRYPTOCLOUD_SHOP_ID = process.env.CRYPTOCLOUD_SHOP_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Проверка обязательных переменных
if (!TOKEN || !MONGO_URI || !CRYPTOCLOUD_API_KEY) {
    logger.error('Отсутствуют обязательные переменные окружения!');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN);
const client = new MongoClient(MONGO_URI);

const adminChatId = 895583535;
const waitingForAction = {};
let selectedRegion = 'RU';
let db, referralService, promoService, botHandlers;

// Подключение к базе данных
async function connectToDb() {
    try {
        await client.connect();
        db = client.db('bot_db');

        // Инициализация сервисов
        referralService = new ReferralService(db);
        promoService = new PromoService(db);
        botHandlers = new BotHandlers(bot, db, referralService, promoService, adminChatId);

        logger.success("Connected to MongoDB and services initialized");
    } catch (e) {
        logger.error("Failed to connect to MongoDB", e);
        process.exit(1);
    }
}

// Функция установки webhook
async function setWebhook() {
    try {
        const webhookUrl = `${WEBHOOK_URL}/webhook_telegram`;
        await bot.setWebHook(webhookUrl);
        logger.success(`Webhook установлен: ${webhookUrl}`);
    } catch (error) {
        logger.error('Ошибка установки webhook:', error);
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
        message: 'Improved Telegram Bot Server v2.0',
        features: [
            'Referral System',
            'Promo Codes',
            'Advanced Logging',
            'Data Validation',
            'Error Handling'
        ],
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        version: '2.0.0'
    });
});

// Webhook для CryptoCloud платежей
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        logger.info('CryptoCloud webhook data received', data);

        if (data.status === 'success') {
            const payload = JSON.parse(data.payload || '{}');
            const userId = payload.chatId;

            await processSuccessfulPayment(userId, data.amount, data.currency, payload);
        }

        res.sendStatus(200);
    } catch (e) {
        logger.error('Webhook error:', e);
        res.sendStatus(500);
    }
});

// Обработка успешной оплаты
async function processSuccessfulPayment(userId, amount, currency, payload) {
    try {
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: userId });
        let purchases = user ? user.purchases : 0;
        purchases++;

        // Обновляем информацию о пользователе
        await usersCollection.updateOne(
            { chatId: userId },
            {
                $set: {
                    purchases: purchases,
                    lastPurchase: new Date(),
                    totalSpent: (user?.totalSpent || 0) + parseFloat(amount)
                }
            },
            { upsert: true }
        );

        // Обрабатываем реферальный бонус
        const referralResult = await referralService.processReferralBonus(userId, parseFloat(amount), currency);

        // Подтверждаем использование промокода, если был
        if (payload.promoCode) {
            await promoService.confirmPromoUsage(userId, payload.promoCode, payload.discount || 0, parseFloat(amount));
        }

        // Отправляем сообщения пользователю
        let successMessage = '✅ *Ваша оплата подтверждена!* Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!';

        if (payload.promoCode) {
            successMessage += `\n\n🎫 Промокод ${payload.promoCode} использован!`;
        }

        await bot.sendMessage(userId, successMessage, { parse_mode: 'Markdown' });

        // Проверяем бонус за количество покупок
        if (purchases % 5 === 0) {
            const bonusAmount = LOYALTY_LEVELS[Math.min(purchases, 50)]?.bonus || 50;
            await bot.sendMessage(userId, `🎉 *Поздравляем!* 🎉 Вы совершили ${purchases} покупок и получаете бонус — *${bonusAmount} бонусных алмазов!*`, { parse_mode: 'Markdown' });
        }

        // Уведомляем о реферальном бонусе
        if (referralResult.success) {
            await bot.sendMessage(referralResult.referrerId,
                `💰 *Реферальный бонус!*\n\nВаш приглашенный друг совершил покупку!\n` +
                `Вы получили: *${referralResult.bonus} бонусных алмазов* 💎`,
                { parse_mode: 'Markdown' }
            );
        }

        // Сообщение админу
        let adminMessage = `✅ *Новая оплата через CryptoCloud!*\n` +
            `Пользователь: ${payload.username}\n` +
            `Сумма: ${amount} ${currency}\n` +
            `Покупок: ${purchases}`;

        if (payload.promoCode) {
            adminMessage += `\n🎫 Промокод: ${payload.promoCode}`;
        }

        if (referralResult.success) {
            adminMessage += `\n💰 Реферальный бонус: ${referralResult.bonus}`;
        }

        await bot.sendMessage(adminChatId, adminMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${userId}` }]
                ]
            }
        });

        // Логируем финансовую операцию
        logger.financial('order', parseFloat(amount), currency, userId, payload);

    } catch (error) {
        logger.error('Error processing successful payment', error);
    }
}

// Webhook для Telegram
app.post('/webhook_telegram', (req, res) => {
    try {
        logger.info('Telegram update received');
        bot.processUpdate(req.body);
        res.sendStatus(200);
    } catch (e) {
        logger.error('processUpdate error:', e);
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

// Функции интерфейса с улучшенной обработкой ошибок
async function showMainMenu(chatId, messageId = null) {
    try {
        const menuText =
            '💎 *ANNUR DIAMONDS v2.0* 💎\n\n' +
            '• Пополнение алмазов для Mobile Legends: Bang Bang\n\n' +
            '• *Способы оплаты:*\n' +
            '• *Россия:* банковские переводы, криптовалюта\n' +
            '• *Кыргызстан:* O! Деньги, Balance.kg\n\n' +
            '⚡ Быстрое пополнение за 5-15 минут!\n\n' +
            '🎁 *Новинки:*\n' +
            '• 👥 Реферальная программа - зарабатывайте с друзей!\n' +
            '• 🎫 Промокоды и скидки\n' +
            '• 📊 Улучшенная система лояльности';

        const keyboard = [
            [
                { text: '💎 Купить алмазы', callback_data: 'buy_diamonds' },
                { text: '📊 История покупок', callback_data: 'purchase_history' }
            ],
            [
                { text: '👥 Рефералы', callback_data: 'referral_menu' },
                { text: '🎫 Промокод', callback_data: 'promo_menu' }
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
            await safeEditMessage(chatId, messageId, menuText, options);
        } else {
            await bot.sendMessage(chatId, menuText, options);
        }

        logger.userAction(chatId, 'main_menu_viewed');

    } catch (error) {
        logger.error('Error showing main menu', error);
        await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте команду /start');
    }
}

// Безопасное редактирование сообщений
async function safeEditMessage(chatId, messageId, text, options) {
    try {
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            ...options
        });
    } catch (error) {
        if (options?.reply_markup) {
            try {
                await bot.editMessageReplyMarkup(options.reply_markup, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } catch (secondError) {
                setTimeout(async () => {
                    await deleteMessage(chatId, messageId);
                    await bot.sendMessage(chatId, text, options);
                }, 100);
            }
        }
    }
}

// Функция удаления сообщения
async function deleteMessage(chatId, messageId) {
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch (error) {
        logger.warn('Message already deleted or cannot be deleted', { chatId, messageId });
    }
}

// Команды бота с улучшенной обработкой
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const referralCode = match ? match[1] : null;

    logger.userAction(chatId, 'bot_started', { referralCode });

    try {
        // Если есть реферальный код, активируем его
        if (referralCode) {
            const result = await referralService.activateReferral(referralCode, chatId);
            if (result.success) {
                await bot.sendMessage(chatId,
                    `🎉 *Добро пожаловать!*\n\n` +
                    `Вы приглашены пользователем ${result.referrerName}!\n` +
                    `Получите скидку 5% на первый заказ! 💎`,
                    { parse_mode: 'Markdown' }
                );
            }
        }

        await showMainMenu(chatId);
    } catch (error) {
        logger.error('Error in start command', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при запуске бота. Попробуйте еще раз.');
    }
});

// Команды через обработчики
bot.onText(/\/history/, (msg) => botHandlers.handleHistory(msg));
bot.onText(/\/mybonus/, (msg) => botHandlers.handleMyBonus(msg));
bot.onText(/\/stats/, (msg) => botHandlers.handleStats(msg));
bot.onText(/\/createpromo/, (msg) => botHandlers.handleCreatePromo(msg));

// Обработка обычных сообщений
bot.on('message', (msg) => botHandlers.handleMessage(msg));

// Обработка callback_query с полной интеграцией новых функций
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
            await botHandlers.showPurchaseHistory(chatId);

        } else if (q.data === 'referral_menu') {
            await showReferralMenu(chatId, messageId);

        } else if (q.data === 'promo_menu') {
            await showPromoMenu(chatId, messageId);

        } else if (q.data === 'share_referral') {
            const stats = await referralService.getReferralStats(chatId);
            if (stats?.referralCode) {
                const shareText = `🎁 Получите скидку 5% на алмазы MLBB!\n\nПрисоединяйтесь по моей ссылке: t.me/your_bot?start=${stats.referralCode}`;
                await bot.sendMessage(chatId, shareText);
            }

        } else if (q.data === 'skip_promo') {
            if (waitingForAction[chatId]) {
                waitingForAction[chatId].step = 'paymentChoice';
                await botHandlers.showPaymentMethods(chatId, waitingForAction[chatId]);
            }

        } else if (q.data === 'retry_promo') {
            await bot.sendMessage(chatId, 'Введите другой промокод:');

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
                await botHandlers.showPaymentMethods(chatId, orderData);
            } else {
                await showMainMenu(chatId, messageId);
            }

        } else if (q.data.startsWith('diamond_')) {
            const selectedItemIndex = q.data.split('_')[1];
            const diamondsData = selectedRegion === 'RU' ? DIAMONDS_DATA_RU : DIAMONDS_DATA_KG;
            const selectedItem = diamondsData[selectedItemIndex];

            waitingForAction[chatId] = {
                step: 'playerId',
                index: selectedItemIndex,
                region: selectedRegion,
                item: selectedItem
            };

            await bot.sendMessage(chatId,
                `Вы выбрали *${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}* за *${selectedItem.price}* ${selectedRegion === 'RU' ? '₽' : 'KGS'}.\n\n` +
                `🎮 Пожалуйста, отправьте мне ID своего аккаунта MLBB:`,
                { parse_mode: 'Markdown' }
            );

            logger.userAction(chatId, 'diamond_selected', { index: selectedItemIndex, region: selectedRegion });

        } else if (q.data.startsWith('pay_crypto_')) {
            await handleCryptoPayment(q);

        } else if (q.data.startsWith('confirm_payment_')) {
            await handlePaymentConfirmation(q, 'confirm');

        } else if (q.data.startsWith('decline_payment_')) {
            await handlePaymentConfirmation(q, 'decline');

        } else if (q.data.startsWith('complete_order_')) {
            await handleOrderCompletion(q);
        }

        // Другие обработчики через botHandlers...

    } catch (e) {
        logger.error('Callback error:', e);
        try {
            await bot.answerCallbackQuery(q.id, { text: 'Произошла ошибка. Попробуйте еще раз.' });
        } catch (answerError) {
            logger.error('Error answering callback:', answerError);
        }
    }
});

// Обработка крипто-платежей с промокодами
async function handleCryptoPayment(q) {
    const [, , index] = q.data.split('_');
    const chatId = q.message.chat.id;
    const orderData = waitingForAction[chatId];
    const diamondsData = orderData.region === 'RU' ? DIAMONDS_DATA_RU : DIAMONDS_DATA_KG;
    const selectedItem = diamondsData[index];

    const currency = selectedRegion === 'RU' ? 'RUB' : 'USD';
    const userFirstName = q.from.first_name;
    const userUsername = q.from.username;

    // Рассчитываем финальную цену с учетом промокода
    const finalPrice = orderData.finalPrice || selectedItem.price;

    try {
        const requestData = {
            shop_id: CRYPTOCLOUD_SHOP_ID,
            amount: parseFloat(finalPrice),
            currency: currency,
            order_id: `diamond_${Date.now()}_${chatId}`,
            description: `${typeof selectedItem.amount === 'number' ? `${selectedItem.amount} алмазов` : selectedItem.amount} для MLBB`,
            payload: JSON.stringify({
                chatId: chatId,
                username: userUsername || userFirstName,
                playerId: orderData.playerId,
                region: orderData.region,
                itemIndex: index,
                promoCode: orderData.promoCode || null,
                discount: orderData.discount || 0
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

            let adminMessage = `📢 *НОВЫЙ ЗАКАЗ (КРИПТО)*\n\n` +
                `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                `*Сумма:* ${finalPrice} ${currency}\n` +
                `*Пользователь:* ${userUsername ? `@${userUsername}` : userFirstName}\n` +
                `*ID пользователя:* ${q.from.id}\n` +
                `*ID игрока MLBB:* ${orderData.playerId}\n` +
                `*Регион:* ${orderData.region}`;

            if (orderData.promoCode) {
                adminMessage += `\n*Промокод:* ${orderData.promoCode} (-${orderData.discount})`;
            }

            await bot.sendMessage(adminChatId, adminMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${q.from.id}` }]
                    ]
                }
            });

            let userMessage = `💳 *Оплата готова!*\n\n` +
                `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n`;

            if (orderData.promoCode) {
                userMessage += `*Промокод:* ${orderData.promoCode}\n` +
                    `*Скидка:* -${orderData.discount} ${currency === 'RUB' ? '₽' : 'KGS'}\n` +
                    `*~~Цена:~~ ${selectedItem.price}*\n`;
            }

            userMessage += `*К оплате:* ${finalPrice} ${currency}\n\n` +
                `Нажмите кнопку ниже для оплаты криптовалютой:`;

            await bot.sendMessage(chatId, userMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Оплатить криптовалютой', url: paymentLink }],
                        [{ text: '🔙 Назад', callback_data: 'back_to_diamonds' }]
                    ]
                }
            });

            delete waitingForAction[chatId];
            logger.userAction(chatId, 'crypto_payment_created', { finalPrice, promoCode: orderData.promoCode });

        } else {
            throw new Error('Неправильный ответ от CryptoCloud API');
        }

    } catch (e) {
        logger.error('CryptoCloud API error:', e);

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
}

// Обработка подтверждения/отклонения платежа
async function handlePaymentConfirmation(q, action) {
    const chatId = q.message.chat.id;

    if (chatId !== adminChatId) return;

    const userId = parseInt(q.data.split('_')[2]);

    if (action === 'confirm') {
        await bot.sendMessage(userId, `✅ *Ваша оплата подтверждена!* Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!`, { parse_mode: 'Markdown' });
        await bot.sendMessage(chatId, 'Подтверждение отправлено пользователю.');

        try {
            const usersCollection = db.collection('users');
            const user = await usersCollection.findOne({ chatId: userId });
            let purchases = user ? user.purchases : 0;
            purchases++;

            await usersCollection.updateOne(
                { chatId: userId },
                { $set: { purchases: purchases, lastPurchase: new Date() } },
                { upsert: true }
            );

            if (purchases % 5 === 0) {
                await bot.sendMessage(userId, `🎉 *Поздравляем!* 🎉 Вы совершили ${purchases} покупок и получаете бонус — *50 бонусных алмазов!*`, { parse_mode: 'Markdown' });
            }

            await bot.sendMessage(chatId, 'Оплата подтверждена. Теперь вы можете пополнить счет клиента и нажать "Заказ выполнен".', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${userId}` }]
                    ]
                }
            });

            logger.userAction(adminChatId, 'payment_confirmed', { userId });

        } catch (error) {
            logger.error('Database error in payment confirmation:', error);
        }

    } else if (action === 'decline') {
        await bot.sendMessage(userId, '❌ *Ваша оплата отклонена.* Пожалуйста, проверьте правильность платежа и повторите попытку.', { parse_mode: 'Markdown' });
        await bot.sendMessage(chatId, 'Отказ отправлен пользователю.');

        logger.userAction(adminChatId, 'payment_declined', { userId });
    }
}

// Обработка завершения заказа
async function handleOrderCompletion(q) {
    const chatId = q.message.chat.id;

    if (chatId !== adminChatId) return;

    const userId = parseInt(q.data.split('_')[2]);

    await bot.sendMessage(userId, `🎉 *Ваш заказ выполнен!* 🎉\n\nПожалуйста, проверьте баланс своего аккаунта в игре. Если вам все понравилось, будем рады вашему отзыву.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Оставить отзыв ❤️', url: 'https://t.me/annurreviews' }],
                [{ text: '👥 Пригласить друга', callback_data: 'referral_menu' }]
            ]
        }
    });
    await bot.sendMessage(chatId, 'Сообщение о выполнении заказа отправлено пользователю.');

    logger.userAction(adminChatId, 'order_completed', { userId });
}

// Добавим недостающие функции меню
async function showRegionMenu(chatId, messageId = null) {
    try {
        const regionText =
            '🌍 *Выберите ваш регион*\n\n' +
            '🇷🇺 *Россия* - переводы, криптовалюта\n' +
            '🇰🇬 *Кыргызстан* - O! Деньги, Balance.kg\n\n' +
            '💡 От региона зависят доступные способы оплаты и цены';

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
            await safeEditMessage(chatId, messageId, regionText, options);
        } else {
            await bot.sendMessage(chatId, regionText, options);
        }

        logger.userAction(chatId, 'region_menu_viewed');

    } catch (error) {
        logger.error('Error showing region menu', error);
        await bot.sendMessage(chatId, 'Ошибка загрузки меню регионов');
    }
}

async function showDiamondsMenu(chatId, messageId = null) {
    try {
        const currency = selectedRegion === 'RU' ? '₽' : 'KGS';
        const diamondsData = selectedRegion === 'RU' ? DIAMONDS_DATA_RU : DIAMONDS_DATA_KG;
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
            `💡 *Подсказка:* Используйте промокоды для скидки!\n` +
            `Все цены указаны с учетом комиссий:`;

        const options = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        };

        if (messageId) {
            await safeEditMessage(chatId, messageId, menuText, options);
        } else {
            await bot.sendMessage(chatId, menuText, options);
        }

        logger.userAction(chatId, 'diamonds_menu_viewed', { region: selectedRegion });

    } catch (error) {
        logger.error('Error showing diamonds menu', error);
        await bot.sendMessage(chatId, 'Ошибка загрузки каталога алмазов');
    }
}

async function showReferralMenu(chatId, messageId = null) {
    try {
        const stats = await referralService.getReferralStats(chatId);

        let referralText = '👥 *РЕФЕРАЛЬНАЯ ПРОГРАММА*\n\n';

        if (!stats?.referralCode) {
            const newCode = await referralService.createReferralCode(chatId);
            referralText += `🎯 *Ваш код:* \`${newCode}\`\n\n`;
        } else {
            referralText += `🎯 *Ваш код:* \`${stats.referralCode}\`\n\n`;
        }

        referralText +=
            `📊 *Статистика:*\n` +
            `• Приглашено: ${stats?.referredCount || 0} человек\n` +
            `• Заработано: ${stats?.totalEarnings || 0} алмазов\n` +
            `• Текущий баланс: ${stats?.currentBonus || 0} алмазов\n\n` +

            `💰 *Как работает:*\n` +
            `• Друг регистрируется по вашему коду\n` +
            `• Получает скидку 5% на первый заказ\n` +
            `• Вы получаете 3% с его заказов\n` +
            `• Чем выше ваш уровень, тем больше бонус!\n\n` +

            `🎁 *Множители по уровням:*\n` +
            `• 5+ покупок: +20% к бонусу\n` +
            `• 10+ покупок: +50% к бонусу\n` +
            `• 20+ покупок: x2 к бонусу`;

        const keyboard = [
            [{ text: '📤 Поделиться кодом', callback_data: 'share_referral' }],
            [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
        ];

        const options = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        };

        if (messageId) {
            await safeEditMessage(chatId, messageId, referralText, options);
        } else {
            await bot.sendMessage(chatId, referralText, options);
        }

        logger.userAction(chatId, 'referral_menu_viewed');

    } catch (error) {
        logger.error('Error showing referral menu', error);
        await bot.sendMessage(chatId, 'Ошибка загрузки реферальной программы');
    }
}

async function showPromoMenu(chatId, messageId = null) {
    try {
        const promoText =
            '🎫 *ПРОМОКОДЫ И СКИДКИ*\n\n' +

            '💡 *Как использовать:*\n' +
            '1. Выберите товар\n' +
            '2. Введите промокод при оформлении\n' +
            '3. Получите скидку!\n\n' +

            '🎁 *Виды промокодов:*\n' +
            '• Скидки на первый заказ\n' +
            '• Сезонные акции\n' +
            '• Специальные предложения\n\n' +

            '📝 Введите промокод или начните покупку:';

        const keyboard = [
            [{ text: '💎 Купить с промокодом', callback_data: 'buy_diamonds' }],
            [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
        ];

        const options = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        };

        // Проверяем, есть ли у пользователя персональный приветственный промокод
        const user = await db.collection('users').findOne({ chatId });
        if (!user?.purchases) {
            const welcomeCode = await promoService.createWelcomePromo(chatId);
            if (welcomeCode) {
                const welcomeText = promoText + `\n🎉 *Специально для вас:* \`${welcomeCode}\`\n*Скидка 7% на первый заказ!*`;

                if (messageId) {
                    await safeEditMessage(chatId, messageId, welcomeText, options);
                } else {
                    await bot.sendMessage(chatId, welcomeText, options);
                }
                return;
            }
        }

        if (messageId) {
            await safeEditMessage(chatId, messageId, promoText, options);
        } else {
            await bot.sendMessage(chatId, promoText, options);
        }

        logger.userAction(chatId, 'promo_menu_viewed');

    } catch (error) {
        logger.error('Error showing promo menu', error);
        await bot.sendMessage(chatId, 'Ошибка загрузки промокодов');
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('Получен сигнал SIGTERM. Завершение работы...');
    await client.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('Получен сигнал SIGINT. Завершение работы...');
    await client.close();
    process.exit(0);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    logger.success(`Server running on port ${PORT}`);
    logger.info(`Webhook URL: ${WEBHOOK_URL}`);
    logger.info('Bot version 2.0 started with all improvements');
});

module.exports = { app, bot, db };