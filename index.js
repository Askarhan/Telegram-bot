// ANNUR DIAMONDS Telegram Bot v2.0
// Модульная архитектура с реферальной системой и промокодами

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');

// Импорт модулей
const { DIAMONDS_DATA_RU, DIAMONDS_DATA_KG, LOYALTY_LEVELS } = require('./config/constants');
const logger = require('./utils/logger');
const Validators = require('./utils/validators');
const ReferralService = require('./services/referralService');
const PromoService = require('./services/promoService');
const BotHandlers = require('./handlers/botHandlers');

logger.info('🚀 Starting ANNUR DIAMONDS Bot v2.0');

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

    // В режиме тестирования продолжаем без выхода
    if (process.argv.includes('--test-mode')) {
        logger.warn('⚠️ Запуск в тестовом режиме без полной конфигурации');
    } else {
        process.exit(1);
    }
}

// Инициализация бота
let bot;
if (TOKEN) {
    if (WEBHOOK_URL) {
        bot = new TelegramBot(TOKEN);
        logger.info('🔗 Bot initialized in webhook mode');
    } else {
        bot = new TelegramBot(TOKEN, { polling: true });
        logger.info('📊 Bot initialized in polling mode');
    }
} else if (process.argv.includes('--test-mode')) {
    logger.warn('⚠️ Bot не инициализирован - нет TOKEN');
}

// Глобальные переменные
let db = null;
let client = null;
let referralService = null;
let promoService = null;
let botHandlers = null;
let selectedRegion = 'RU';

// Подключение к MongoDB
async function connectToDatabase() {
    try {
        client = new MongoClient(MONGO_URI, {
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
        });
        await client.connect();
        db = client.db('telegram_bot');

        // Инициализация сервисов
        referralService = new ReferralService(db);
        promoService = new PromoService(db);
        botHandlers = new BotHandlers(bot, db, referralService, promoService);

        logger.info('✅ Database connected successfully');
        return true;
    } catch (error) {
        logger.error('❌ Database connection failed:', error);
        return false;
    }
}

// Вспомогательные функции
function escapeMarkdown(text) {
    // Экранируем специальные символы Markdown
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

async function safeEditMessage(chatId, messageId, text, options = {}) {
    try {
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            ...options
        });
    } catch (error) {
        if (error.code !== 'ETELEGRAM' || !error.response || error.response.body.error_code !== 400) {
            logger.error('Error editing message:', error);
        }
    }
}

async function deleteMessage(chatId, messageId) {
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch (error) {
        logger.error('Error deleting message:', error);
    }
}

// Главное меню
async function showMainMenu(chatId, messageId = null) {
    const welcomeText =
        '💎 *ANNUR DIAMONDS*\n\n' +
        '🎮 *Mobile Legends: Bang Bang*\n' +
        '⚡ Быстрое пополнение алмазов\n' +
        '🔒 Безопасные платежи\n' +
        '🎁 Бонусы и промокоды\n\n' +
        '👥 *Рефералы* - приглашайте друзей\n' +
        '📊 *История* - отслеживайте покупки';

    const keyboard = [
        [{ text: '💎 Купить алмазы', callback_data: 'buy_diamonds' }],
        [
            { text: '👥 Рефералы', callback_data: 'referral_menu' },
            { text: '🎫 Промокод', callback_data: 'promo_menu' }
        ],
        [{ text: '📊 История покупок', callback_data: 'purchase_history' }],
        [
            { text: '📞 Поддержка', callback_data: 'support' },
            { text: '💖 Отзывы', url: 'https://t.me/annurreviews' }
        ]
    ];

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    };

    try {
        if (messageId) {
            await safeEditMessage(chatId, messageId, welcomeText, options);
        } else {
            await bot.sendMessage(chatId, welcomeText, options);
        }
    } catch (error) {
        logger.error('Error showing main menu:', error);
    }
}

// Меню рефералов
async function showReferralMenu(chatId, messageId = null) {
    try {
        if (!referralService) {
            await bot.sendMessage(chatId, '❌ Сервис рефералов недоступен');
            return;
        }

        let stats = await referralService.getReferralStats(chatId);
        if (!stats) {
            await referralService.createReferralCode(chatId);
            stats = await referralService.getReferralStats(chatId);
        }

        const referralText =
            `👥 *Реферальная программа*\n\n` +
            `🔗 *Ваш код:* \`${stats.referralCode}\`\n` +
            `💰 *Ваш бонус:* ${stats.currentBonus} алмазов\n` +
            `👨‍👩‍👧‍👦 *Приглашено:* ${stats.referralsCount} друзей\n` +
            `📈 *Заработано:* ${stats.totalEarned} алмазов\n\n` +
            `🎁 *Условия:*\n` +
            `• Друг получает скидку 5\\%\n` +
            `• Вы получаете 3\\% с покупки\n` +
            `• Бонусы начисляются мгновенно`;

        const keyboard = [
            [{ text: '📤 Поделиться ссылкой', callback_data: 'share_referral' }],
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

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'referral_menu_viewed');
        }

    } catch (error) {
        logger.error('Error showing referral menu:', error);
        await bot.sendMessage(chatId, '❌ Ошибка загрузки реферальной программы');
    }
}

// Меню промокодов
async function showPromoMenu(chatId, messageId = null) {
    try {
        if (!promoService) {
            await bot.sendMessage(chatId, '❌ Сервис промокодов недоступен');
            return;
        }

        // Создаем приветственный промокод для нового пользователя
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: chatId });

        let promoText = `🎫 *Промокоды*\n\n`;

        if (!user || user.purchases === 0) {
            const welcomePromo = await promoService.createWelcomePromo(chatId);
            if (welcomePromo) {
                promoText += `🎁 *Приветственный промокод для новичков:*\n`;
                promoText += `\`${welcomePromo.code}\` - скидка ${welcomePromo.discount}%\n\n`;
            }
        }

        promoText += `💡 *Как использовать:*\n`;
        promoText += `• Введите промокод при оформлении заказа\n`;
        promoText += `• Скидка применится автоматически\n`;
        promoText += `• Промокоды одноразовые\n\n`;
        promoText += `🔍 *Следите за новыми промокодами в нашем канале!*`;

        const keyboard = [
            [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
        ];

        const options = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        };

        if (messageId) {
            await safeEditMessage(chatId, messageId, promoText, options);
        } else {
            await bot.sendMessage(chatId, promoText, options);
        }

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'promo_menu_viewed');
        }

    } catch (error) {
        logger.error('Error showing promo menu:', error);
        await bot.sendMessage(chatId, '❌ Ошибка загрузки промокодов');
    }
}

// История покупок
async function showPurchaseHistory(chatId) {
    try {
        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна');
            return;
        }

        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: chatId });
        const purchases = (user && user.purchases) ? user.purchases : 0;
        const totalSpent = (user && user.totalSpent) ? user.totalSpent : 0;
        const lastPurchase = (user && user.lastPurchase) ? user.lastPurchase : null;

        // Получаем реферальную статистику
        let referralStats = null;
        if (referralService) {
            try {
                referralStats = await referralService.getReferralStats(chatId);
            } catch (error) {
                logger.error('Error getting referral stats', error);
            }
        }

        let historyText = `📊 *История покупок*\n\n`;
        historyText += `👤 *Покупки:* ${purchases}\n`;
        historyText += `💰 *Потрачено:* ${totalSpent.toFixed(2)}\n`;

        if (referralStats && referralStats.currentBonus !== undefined) {
            historyText += `💎 *Реферальные бонусы:* ${referralStats.currentBonus}\n`;
        }

        if (purchases === 0) {
            historyText += `💎 *Статус:* Новый клиент\n\n`;
            historyText += `🌟 Совершите покупку и получите бонусы\\!\n`;
        } else {
            const untilBonus = 5 - (purchases % 5);
            const bonusesReceived = Math.floor(purchases / 5);

            historyText += `🎁 *Бонусов получено:* ${bonusesReceived}\n`;
            if (untilBonus === 5) {
                historyText += `✨ *Готов к получению бонуса\\!*\n`;
            } else {
                historyText += `⏳ *До бонуса:* ${untilBonus} покупок\n`;
            }

            if (lastPurchase && lastPurchase instanceof Date) {
                historyText += `📅 *Последняя покупка:* ${lastPurchase.toLocaleDateString('ru-RU')}\n`;
            } else if (lastPurchase && typeof lastPurchase === 'string') {
                historyText += `📅 *Последняя покупка:* ${new Date(lastPurchase).toLocaleDateString('ru-RU')}\n`;
            }
        }

        // Уровень лояльности
        let loyaltyLevel = '';
        if (purchases >= 50) loyaltyLevel = '👑 Легенда';
        else if (purchases >= 20) loyaltyLevel = '💎 VIP клиент';
        else if (purchases >= 10) loyaltyLevel = '⭐ Постоянный клиент';
        else if (purchases >= 5) loyaltyLevel = '🔥 Активный покупатель';
        else if (purchases >= 1) loyaltyLevel = '🌱 Новичок';
        else loyaltyLevel = '👋 Гость';

        historyText += `\n${loyaltyLevel}`;

        const keyboard = [
            [{ text: '💎 Купить алмазы', callback_data: 'buy_diamonds' }],
            [{ text: '👥 Рефералы', callback_data: 'referral_menu' }],
            [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
        ];

        await bot.sendMessage(chatId, historyText, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'purchase_history_viewed');
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error showing purchase history:', error);
        } else {
            console.error('Error showing purchase history:', error);
        }

        if (bot && bot.sendMessage) {
            await bot.sendMessage(chatId, '❌ Ошибка получения истории покупок');
        }
    }
}

// Меню регионов
async function showRegionMenu(chatId, messageId = null) {
    const regionText =
        '🌍 *Выберите ваш регион*\n\n' +
        '🇷🇺 *Россия* - карты, криптовалюта\n' +
        '🇰🇬 *Кыргызстан* - O! Деньги, Balance.kg\n\n' +
        '💡 От региона зависят способы оплаты и цены';

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
        logger.error('Error showing region menu:', error);
    }
}

// Меню алмазов
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
            `💡 *Подсказка:* Используйте промокоды для скидки!`;

        const options = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        };

        if (messageId) {
            await safeEditMessage(chatId, messageId, menuText, options);
        } else {
            await bot.sendMessage(chatId, menuText, options);
        }

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'diamonds_menu_viewed', { region: selectedRegion });
        }

    } catch (error) {
        logger.error('Error showing diamonds menu', error);
        await bot.sendMessage(chatId, '❌ Ошибка загрузки каталога алмазов');
    }
}

// Обработчики команд
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const referralCode = match[1] ? match[1].trim() : null;

    if (logger && logger.userAction) {
        logger.userAction(chatId, 'bot_started', { referralCode });
    }

    if (referralCode && referralService) {
        try {
            const success = await referralService.activateReferral(chatId, referralCode);
            if (success) {
                await bot.sendMessage(chatId, '🎉 Вы успешно активировали реферальный код! Скидка 5% на первую покупку!');
            }
        } catch (error) {
            logger.error('Error activating referral:', error);
        }
    }

    await showMainMenu(chatId);
});

// Обработчик callback запросов
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    try {
        await bot.answerCallbackQuery(q.id);

        // Основные команды меню
        if (q.data === 'buy_diamonds') {
            await showRegionMenu(chatId, messageId);
        } else if (q.data === 'referral_menu') {
            await showReferralMenu(chatId, messageId);
        } else if (q.data === 'promo_menu') {
            await showPromoMenu(chatId, messageId);
        } else if (q.data === 'purchase_history') {
            await deleteMessage(chatId, messageId);
            await showPurchaseHistory(chatId);
        } else if (q.data === 'share_referral') {
            if (referralService) {
                const stats = await referralService.getReferralStats(chatId);
                if (stats?.referralCode) {
                    const shareText = `🎁 Получите скидку 5% на алмазы MLBB!\n\nПрисоединяйтесь по моей ссылке: t.me/your_bot?start=${stats.referralCode}`;
                    await bot.sendMessage(chatId, shareText);
                }
            }
        } else if (q.data === 'back_to_start') {
            await showMainMenu(chatId, messageId);
        } else if (q.data === 'support') {
            await bot.sendMessage(chatId, '📞 *Поддержка*\n\nПо всем вопросам обращайтесь к администратору: @annur\\_admin', { parse_mode: 'Markdown' });
        } else if (q.data.startsWith('region_')) {
            const region = q.data.split('_')[1].toUpperCase();
            selectedRegion = region;
            await showDiamondsMenu(chatId, messageId);
        } else if (q.data === 'back_to_regions') {
            await showRegionMenu(chatId, messageId);
        } else if (q.data.startsWith('diamond_')) {
            // Здесь будет обработка выбора алмазов
            await bot.sendMessage(chatId, 'Обработка покупки будет добавлена в следующей версии');
        }

    } catch (error) {
        logger.error('Error handling callback query:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте еще раз.');
    }
});

// Express сервер
app.get('/', (req, res) => {
    res.json({
        status: 'ANNUR DIAMONDS Bot v2.0 активен',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        features: ['referrals', 'promo-codes', 'analytics']
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

if (WEBHOOK_URL) {
    app.post(`/bot${TOKEN}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('🔄 Получен сигнал SIGTERM. Завершение работы...');
    try {
        if (client) await client.close();
        logger.info('✅ Database connection closed');
    } catch (error) {
        logger.error('❌ Error closing database:', error);
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('🔄 Получен сигнал SIGINT. Завершение работы...');
    try {
        if (client) await client.close();
        logger.info('✅ Database connection closed');
    } catch (error) {
        logger.error('❌ Error closing database:', error);
    }
    process.exit(0);
});

// Запуск приложения
async function startBot() {
    try {
        const dbConnected = await connectToDatabase();
        if (!dbConnected) {
            logger.error('❌ Не удалось подключиться к базе данных');
            process.exit(1);
        }

        // Регистрация дополнительных команд после инициализации сервисов
        if (botHandlers) {
            bot.onText(/\/stats/, (msg) => botHandlers.handleStats(msg));
            bot.onText(/\/createpromo (.+)/, (msg, match) => botHandlers.handleCreatePromo(msg, match));
            bot.onText(/\/history/, (msg) => botHandlers.handleHistory(msg));
            bot.onText(/\/mybonus/, (msg) => botHandlers.handleMyBonus(msg));
        }

        if (WEBHOOK_URL) {
            await bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
            logger.info(`🔗 Webhook установлен: ${WEBHOOK_URL}/bot${TOKEN}`);
        }

        app.listen(PORT, () => {
            logger.info(`🚀 Bot server запущен на порту ${PORT}`);
            logger.info('✅ ANNUR DIAMONDS Bot v2.0 готов к работе!');
        });

    } catch (error) {
        logger.error('❌ Ошибка запуска бота:', error);
        process.exit(1);
    }
}

startBot();