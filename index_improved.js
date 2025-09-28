// Улучшенный Telegram-бот для продажи алмазов MLBB
// Версия с реферальной системой, промокодами и улучшенной безопасностью

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
let db, referralService, promoService;

// Подключение к базе данных
async function connectToDb() {
    try {
        await client.connect();
        db = client.db('bot_db');

        // Инициализация сервисов
        referralService = new ReferralService(db);
        promoService = new PromoService(db);

        logger.success("Connected to MongoDB");
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
        message: 'Improved Telegram Bot Server',
        version: '2.0',
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

        // Отправляем сообщения пользователю
        await bot.sendMessage(userId, '✅ *Ваша оплата подтверждена!* Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!', { parse_mode: 'Markdown' });

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
        await bot.sendMessage(adminChatId,
            `✅ *Новая оплата через CryptoCloud!*\n` +
            `Пользователь: ${payload.username}\n` +
            `Сумма: ${amount} ${currency}\n` +
            `Покупок: ${purchases}` +
            (referralResult.success ? `\n💰 Реферальный бонус: ${referralResult.bonus}` : ''),
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${userId}` }]
                    ]
                }
            }
        );

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
            '💎 *ANNUR DIAMONDS* 💎\n\n' +
            '• Пополнение алмазов для Mobile Legends: Bang Bang\n\n' +
            '• *Способы оплаты:*\n' +
            '• *Россия:* банковские переводы, криптовалюта\n' +
            '• *Кыргызстан:* O! Деньги, Balance.kg\n\n' +
            '⚡ Быстрое пополнение за 5-15 минут!\n\n' +
            '🎁 *Новинки:*\n' +
            '• Реферальная программа\n' +
            '• Промокоды и скидки\n' +
            '• Система лояльности';

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

// Меню рефералов
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

// Меню промокодов
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

// Улучшенная функция показа региона
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

// Показать меню алмазов с улучшенным форматированием
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

// Функция удаления сообщения
async function deleteMessage(chatId, messageId) {
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch (error) {
        logger.warn('Message already deleted or cannot be deleted', { chatId, messageId });
    }
}

// Команды бота
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

// Продолжение в следующей части...