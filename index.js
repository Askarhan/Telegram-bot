// ANNUR DIAMONDS Telegram Bot v2.0
// Полная версия с реферальной системой, промокодами и улучшенной безопасностью

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

logger.info('🚀 Starting ANNUR DIAMONDS Bot v2.0');
logger.info('🔍 Checking environment variables...');

console.log('🔍 Checking environment variables:');
console.log('TOKEN exists:', !!process.env.TOKEN);
console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('CRYPTOCLOUD_API_KEY exists:', !!process.env.CRYPTOCLOUD_API_KEY);
console.log('WEBHOOK_URL:', process.env.WEBHOOK_URL || 'Not set (polling mode)');

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
    logger.error('❌ Отсутствуют обязательные переменные окружения!');
    logger.error('Убедитесь, что настроены: TOKEN, MONGO_URI, CRYPTOCLOUD_API_KEY');
    process.exit(1);
}

// Инициализация бота
let bot;
if (WEBHOOK_URL) {
    bot = new TelegramBot(TOKEN);
    logger.info('🔗 Bot initialized in webhook mode');
} else {
    bot = new TelegramBot(TOKEN, { polling: true });
    logger.info('🔄 Bot initialized in polling mode');
}

const client = new MongoClient(MONGO_URI);

// Настройки бота
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

        logger.success("✅ Connected to MongoDB and services initialized");
        return true;
    } catch (e) {
        logger.error("❌ Failed to connect to MongoDB", e);
        return false;
    }
}

// Функция установки webhook
async function setWebhook() {
    try {
        const webhookUrl = `${WEBHOOK_URL}/webhook_telegram`;
        await bot.setWebHook(webhookUrl);
        logger.success(`✅ Webhook установлен: ${webhookUrl}`);
    } catch (error) {
        logger.error('❌ Ошибка установки webhook:', error);
    }
}

// Инициализация при запуске
async function initialize() {
    const dbConnected = await connectToDb();
    if (!dbConnected) {
        logger.error('❌ Cannot start bot without database connection');
        process.exit(1);
    }

    if (WEBHOOK_URL) {
        await setWebhook();
    } else {
        logger.info('📱 Starting in polling mode - no webhook setup needed');
    }

    logger.success('🎉 Bot successfully initialized and ready!');
}

// Health check endpoints
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        message: 'ANNUR DIAMONDS Bot v2.0',
        version: '2.0.0',
        features: [
            'Referral System (3% from profit)',
            'Promo Codes with Admin Control',
            'Advanced Logging & Analytics',
            'Data Validation & Security',
            'Modular Architecture'
        ],
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        version: '2.0.0',
        database: db ? 'connected' : 'disconnected'
    });
});

// Webhook для CryptoCloud платежей
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        logger.info('💰 CryptoCloud webhook received', { amount: data.amount, status: data.status });

        if (data.status === 'success') {
            const payload = JSON.parse(data.payload || '{}');
            const userId = payload.chatId;

            await processSuccessfulPayment(userId, data.amount, data.currency, payload);
        }

        res.sendStatus(200);
    } catch (e) {
        logger.error('❌ Webhook error:', e);
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
        logger.error('❌ Error processing successful payment', error);
    }
}

// Webhook для Telegram
app.post('/webhook_telegram', (req, res) => {
    try {
        logger.info('📨 Telegram update received');
        bot.processUpdate(req.body);
        res.sendStatus(200);
    } catch (e) {
        logger.error('❌ processUpdate error:', e);
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
        logger.error('❌ Error showing main menu', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте команду /start');
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
        // Fallback: удаляем старое и создаем новое сообщение
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (delError) {
            // Игнорируем ошибки удаления
        }
        await bot.sendMessage(chatId, text, options);
    }
}

// Команды бота
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const referralCode = match ? match[1] : null;

    logger.userAction(chatId, 'bot_started', { referralCode });

    try {
        // Если есть реферальный код, активируем его
        if (referralCode && referralService) {
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
        logger.error('❌ Error in start command', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка при запуске бота. Попробуйте еще раз.');
    }
});

// Команды через обработчики (если сервисы готовы)
bot.onText(/\/history/, (msg) => {
    if (botHandlers) {
        botHandlers.handleHistory(msg);
    } else {
        bot.sendMessage(msg.chat.id, '⏳ Сервисы бота еще инициализируются. Попробуйте через несколько секунд.');
    }
});

bot.onText(/\/mybonus/, (msg) => {
    if (botHandlers) {
        botHandlers.handleMyBonus(msg);
    } else {
        bot.sendMessage(msg.chat.id, '⏳ Сервисы бота еще инициализируются. Попробуйте через несколько секунд.');
    }
});

bot.onText(/\/stats/, (msg) => {
    if (botHandlers) {
        botHandlers.handleStats(msg);
    } else {
        bot.sendMessage(msg.chat.id, '⏳ Сервисы бота еще инициализируются. Попробуйте через несколько секунд.');
    }
});

bot.onText(/\/createpromo/, (msg) => {
    if (botHandlers) {
        botHandlers.handleCreatePromo(msg);
    } else {
        bot.sendMessage(msg.chat.id, '⏳ Сервисы бота еще инициализируются. Попробуйте через несколько секунд.');
    }
});

// Обработка обычных сообщений
bot.on('message', (msg) => {
    if (botHandlers) {
        botHandlers.handleMessage(msg);
    }
});

// Базовые обработчики callback_query (упрощенная версия)
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    try {
        await bot.answerCallbackQuery(q.id);

        // Основные команды меню
        if (q.data === 'buy_diamonds') {
            await showRegionMenu(chatId, messageId);
        } else if (q.data === 'back_to_start') {
            await showMainMenu(chatId, messageId);
        } else if (q.data === 'support') {
            await bot.sendMessage(chatId, '📞 *Поддержка*\n\nПо всем вопросам обращайтесь к администратору: @annur_admin', { parse_mode: 'Markdown' });
        } else if (q.data === 'reviews') {
            await bot.sendMessage(chatId, '💖 Отзывы наших клиентов: https://t.me/annurreviews');
        }
        // Остальные обработчики будут подключены после полной инициализации

    } catch (e) {
        logger.error('❌ Callback error:', e);
        try {
            await bot.answerCallbackQuery(q.id, { text: 'Произошла ошибка. Попробуйте еще раз.' });
        } catch (answerError) {
            logger.error('❌ Error answering callback:', answerError);
        }
    }
});

// Функция показа регионов (упрощенная)
async function showRegionMenu(chatId, messageId = null) {
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

    try {
        if (messageId) {
            await safeEditMessage(chatId, messageId, regionText, options);
        } else {
            await bot.sendMessage(chatId, regionText, options);
        }
    } catch (error) {
        logger.error('❌ Error showing region menu', error);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('🔄 Получен сигнал SIGTERM. Завершение работы...');
    try {
        await client.close();
        logger.info('✅ Database connection closed');
    } catch (error) {
        logger.error('❌ Error closing database:', error);
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('🔄 Получен сигнал SIGINT. Завершение работы...');
    try {
        await client.close();
        logger.info('✅ Database connection closed');
    } catch (error) {
        logger.error('❌ Error closing database:', error);
    }
    process.exit(0);
});

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
    logger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// Запуск сервера
const server = app.listen(PORT, '0.0.0.0', async () => {
    logger.success(`🚀 Server running on port ${PORT}`);
    logger.info(`📍 Webhook URL: ${WEBHOOK_URL || 'Not using webhooks (polling mode)'}`);

    // Инициализируем бот после запуска сервера
    await initialize();
});

// Экспорт для тестирования
module.exports = { app, bot, db, server };