// ANNUR DIAMONDS Telegram Bot v2.0
// Модульная архитектура с реферальной системой и промокодами

require('dotenv').config();
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

// 🔍 ДИАГНОСТИКА МОДУЛЕЙ
console.log('🔍 Checking module imports:');
console.log('DIAMONDS_DATA_RU loaded:', !!DIAMONDS_DATA_RU);
console.log('logger loaded:', !!logger);
console.log('Validators loaded:', !!Validators);
console.log('ReferralService loaded:', !!ReferralService);
console.log('PromoService loaded:', !!PromoService);
console.log('BotHandlers loaded:', !!BotHandlers);

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
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '895583535'; // Chat ID администратора

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
        console.log('🔄 Attempting to edit message:', { chatId, messageId, textLength: text.length });
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            ...options
        });
        console.log('✅ Message edited successfully');
    } catch (error) {
        console.log('❌ Error editing message:', error.message);
        if (error.code !== 'ETELEGRAM' || !error.response || error.response.body.error_code !== 400) {
            if (logger && logger.error) {
                logger.error('Error editing message:', error);
            }
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
            { text: '📞 Поддержка', url: `tg://user?id=${ADMIN_CHAT_ID}` },
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
            `• Друг получает скидку 5%\n` +
            `• Вы получаете 3% с покупки\n` +
            `• Бонусы начисляются мгновенно`;

        const keyboard = [
            [{ text: '📤 Поделиться ссылкой', callback_data: 'share_referral' }],
            [{ text: '🎟️ Вывести бонусы', callback_data: 'withdraw_bonus' }],
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

// Меню вывода реферальных бонусов
async function showWithdrawBonusMenu(chatId, messageId = null) {
    try {
        if (!referralService) {
            await bot.sendMessage(chatId, '❌ Сервис рефералов недоступен');
            return;
        }

        const stats = await referralService.getReferralStats(chatId);
        if (!stats || stats.currentBonus === 0) {
            await bot.sendMessage(chatId, '❌ У вас нет бонусов для вывода');
            return;
        }

        // Доступные пакеты для вывода (в алмазах)
        const availablePackages = [56, 86, 172, 257, 706, 2195, 3688, 5532, 9288];

        // Фильтруем пакеты, которые пользователь может себе позволить
        const affordablePackages = availablePackages.filter(amount => amount <= stats.currentBonus);

        if (affordablePackages.length === 0) {
            await bot.sendMessage(chatId,
                `❌ Недостаточно бонусов\n\n` +
                `💎 Ваш баланс: ${stats.currentBonus} алмазов\n` +
                `📊 Минимальный пакет: 56 алмазов\n\n` +
                `Продолжайте приглашать друзей!`
            );
            return;
        }

        const withdrawText =
            `🎟️ *Вывод реферальных бонусов*\n\n` +
            `💎 *Ваш баланс:* ${stats.currentBonus} алмазов\n\n` +
            `📝 *Выберите пакет для вывода:*\n` +
            `Бонусы будут автоматически конвертированы в купон`;

        // Создаем клавиатуру с доступными пакетами
        const keyboard = [];
        for (let i = 0; i < affordablePackages.length; i += 2) {
            const row = [];
            row.push({
                text: `💎 ${affordablePackages[i]}`,
                callback_data: `withdraw_${affordablePackages[i]}`
            });
            if (affordablePackages[i + 1]) {
                row.push({
                    text: `💎 ${affordablePackages[i + 1]}`,
                    callback_data: `withdraw_${affordablePackages[i + 1]}`
                });
            }
            keyboard.push(row);
        }
        keyboard.push([{ text: '🔙 Назад', callback_data: 'referral_menu' }]);

        const options = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        };

        if (messageId) {
            await safeEditMessage(chatId, messageId, withdrawText, options);
        } else {
            await bot.sendMessage(chatId, withdrawText, options);
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error showing withdraw bonus menu:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка при показе меню вывода');
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
            historyText += `🌟 Совершите покупку и получите бонусы!\n`;
        } else {
            const untilBonus = 5 - (purchases % 5);
            const bonusesReceived = Math.floor(purchases / 5);

            historyText += `🎁 *Бонусов получено:* ${bonusesReceived}\n`;
            if (untilBonus === 5) {
                historyText += `✨ *Готов к получению бонуса!*\n`;
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
        '🇷🇺 *Россия* - переводы, криптовалюта\n' +
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

// Форма заказа
async function showOrderForm(chatId, messageId, diamondIndex) {
    try {
        const diamondsData = selectedRegion === 'RU' ? DIAMONDS_DATA_RU : DIAMONDS_DATA_KG;
        const selectedDiamond = diamondsData[diamondIndex];

        if (!selectedDiamond) {
            await bot.sendMessage(chatId, '❌ Неверный выбор пакета алмазов');
            return;
        }

        const currency = selectedRegion === 'RU' ? '₽' : 'KGS';
        const amountText = typeof selectedDiamond.amount === 'number'
            ? `${selectedDiamond.amount} 💎`
            : selectedDiamond.amount;

        const orderText =
            `🛒 *Оформление заказа*\n\n` +
            `💎 *Товар:* ${amountText}\n` +
            `💰 *Цена:* ${selectedDiamond.price.toLocaleString('ru-RU')} ${currency}\n` +
            `🌍 *Регион:* ${selectedRegion === 'RU' ? '🇷🇺 Россия' : '🇰🇬 Кыргызстан'}\n\n` +
            `📝 *Для завершения заказа введите:*\n` +
            `• ID игрока (цифры, скобки, пробелы)\n` +
            `• Server ID (цифры, скобки, пробелы)\n` +
            `• Промокод (опционально)\n\n` +
            `*Формат:* \`ID SERVER ПРОМОКОД\`\n` +
            `\`123456789 1234 WELCOME10\`\n` +
            `\`1121312 (2312) PROMO5\`\n\n` +
            `💡 Промокод можно не указывать`;

        const keyboard = [
            [{ text: '🔙 К выбору алмазов', callback_data: 'back_to_diamonds' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_start' }]
        ];

        const options = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        };

        if (messageId) {
            await safeEditMessage(chatId, messageId, orderText, options);
        } else {
            await bot.sendMessage(chatId, orderText, options);
        }

        // Сохраняем информацию о заказе для данного пользователя
        if (!global.userOrders) global.userOrders = {};
        global.userOrders[chatId] = {
            diamondIndex,
            region: selectedRegion,
            diamond: selectedDiamond,
            timestamp: new Date()
        };

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'order_form_shown', {
                diamondIndex,
                amount: selectedDiamond.amount,
                price: selectedDiamond.price,
                region: selectedRegion
            });
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error showing order form:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка при создании формы заказа');
    }
}

// Обработка ввода данных заказа
async function processOrderInput(chatId, text) {
    try {
        const orderInfo = global.userOrders[chatId];
        if (!orderInfo) {
            await bot.sendMessage(chatId, '❌ Активный заказ не найден. Начните сначала.');
            return;
        }

        // Парсим ввод: ID SERVER ПРОМОКОД
        const parts = text.trim().split(/\s+/);
        if (parts.length < 2) {
            await bot.sendMessage(chatId,
                '❌ Неверный формат!\n\n' +
                'Укажите как минимум:\n' +
                '• ID игрока\n' +
                '• Server ID\n\n' +
                'Пример: 123456789 1234'
            );
            return;
        }

        const playerId = parts[0];
        const serverId = parts[1];
        const promoCode = parts[2] || null;

        // Валидация ID (разрешаем цифры, скобки и пробелы)
        if (!/^[\d\s\(\)]+$/.test(playerId) || !/^[\d\s\(\)]+$/.test(serverId)) {
            await bot.sendMessage(chatId,
                '❌ ID должны содержать только цифры, скобки и пробелы!\n\n' +
                'Player ID и Server ID могут содержать цифры, скобки () и пробелы.\n' +
                'Примеры: 123456789 1234 или 1121312 (2312)'
            );
            return;
        }

        // Проверяем купон (имеет наивысший приоритет)
        let discount = 0;
        let discountAmount = 0;
        let promoValid = false;
        let referralDiscount = 0;
        let isCoupon = false;
        let couponData = null;

        if (promoCode && db) {
            try {
                const couponsCollection = db.collection('coupons');
                const coupon = await couponsCollection.findOne({
                    code: promoCode,
                    used: false,
                    expiresAt: { $gt: new Date() }
                });

                if (coupon) {
                    // Проверяем, соответствует ли купон выбранному пакету
                    const diamondAmount = typeof orderInfo.diamond.amount === 'number'
                        ? orderInfo.diamond.amount
                        : null;

                    if (diamondAmount === coupon.diamondAmount) {
                        isCoupon = true;
                        couponData = coupon;
                        discount = 100; // 100% скидка (бесплатно)
                        discountAmount = orderInfo.diamond.price;
                    }
                }
            } catch (error) {
                if (logger && logger.error) {
                    logger.error('Error checking coupon:', error);
                }
            }
        }

        // Проверяем реферальную скидку (только если не купон)
        if (!isCoupon && referralService && db) {
            try {
                const user = await db.collection('users').findOne({ chatId: chatId });
                if (user?.referredBy) {
                    // Проверяем, это первая покупка или нет
                    const ordersCount = await db.collection('orders').countDocuments({
                        chatId: chatId,
                        status: 'confirmed'
                    });

                    if (ordersCount === 0) {
                        referralDiscount = 5; // 5% скидка для приглашенных
                        discount = referralDiscount;
                        discountAmount = Math.round(orderInfo.diamond.price * discount / 100);
                    }
                }
            } catch (error) {
                if (logger && logger.error) {
                    logger.error('Error checking referral discount:', error);
                }
            }
        }

        // Проверяем промокод если указан (только если это не купон и промокод перезаписывает реферальную скидку если выгоднее)
        if (!isCoupon && promoCode && promoService) {
            try {
                const promoResult = await promoService.validatePromo(promoCode, chatId);
                if (promoResult.valid && promoResult.discount > discount) {
                    discount = promoResult.discount;
                    discountAmount = Math.round(orderInfo.diamond.price * discount / 100);
                    promoValid = true;
                    referralDiscount = 0; // Отменяем реферальную скидку
                }
            } catch (error) {
                if (logger && logger.error) {
                    logger.error('Error validating promo code:', error);
                }
            }
        }

        // Создаем заказ
        await createPaymentOrder(chatId, {
            ...orderInfo,
            playerId,
            serverId,
            promoCode,
            discount,
            discountAmount,
            promoValid,
            referralDiscount,
            isCoupon,
            couponData
        });

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error processing order input:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка при обработке заказа');
    }
}

// Создание платежного заказа
async function createPaymentOrder(chatId, orderData) {
    try {
        const finalPrice = orderData.diamond.price - orderData.discountAmount;
        const currency = orderData.region === 'RU' ? 'RUB' : 'KGS';
        const amountText = typeof orderData.diamond.amount === 'number'
            ? `${orderData.diamond.amount} 💎`
            : orderData.diamond.amount;

        // Подтверждение заказа
        let confirmText = `✅ *Подтверждение заказа*\n\n`;
        confirmText += `💎 *Товар:* ${amountText}\n`;
        confirmText += `👤 *Player ID:* ${orderData.playerId}\n`;
        confirmText += `🌐 *Server ID:* ${orderData.serverId}\n`;
        confirmText += `🌍 *Регион:* ${orderData.region === 'RU' ? '🇷🇺 Россия' : '🇰🇬 Кыргызстан'}\n\n`;

        if (orderData.isCoupon) {
            confirmText += `🎟️ *Купон:* ${orderData.promoCode}\n`;
            confirmText += `💰 *Цена:* ~~${orderData.diamond.price}~~ → *БЕСПЛАТНО* ✨\n`;
            // Проверяем тип купона
            if (orderData.couponData && orderData.couponData.type === 'referral_bonus') {
                confirmText += `🎁 Оплачено реферальными бонусами\n\n`;
            } else {
                confirmText += `🎉 Купон активирован успешно!\n\n`;
            }
        } else if (orderData.referralDiscount > 0) {
            confirmText += `🎁 *Реферальная скидка:* -${orderData.referralDiscount}%\n`;
            confirmText += `💰 *Цена:* ~~${orderData.diamond.price}~~ → *${finalPrice}* ${currency}\n`;
            confirmText += `💸 *Скидка:* ${orderData.discountAmount} ${currency}\n\n`;
        } else if (orderData.promoValid) {
            confirmText += `🎫 *Промокод:* ${orderData.promoCode} (-${orderData.discount}%)\n`;
            confirmText += `💰 *Цена:* ~~${orderData.diamond.price}~~ → *${finalPrice}* ${currency}\n`;
            confirmText += `💸 *Скидка:* ${orderData.discountAmount} ${currency}\n\n`;
        } else {
            confirmText += `💰 *Цена:* ${finalPrice} ${currency}\n\n`;
            if (orderData.promoCode && !orderData.isCoupon) {
                confirmText += `❌ Промокод "${orderData.promoCode}" недействителен\n\n`;
            }
        }

        // Создаем короткий уникальный ID заказа (4 цифры)
        const orderId = Math.floor(1000 + Math.random() * 9000).toString();

        // Если купон - обрабатываем сразу без оплаты
        if (orderData.isCoupon) {
            confirmText += `\n✅ *Заказ автоматически оформлен!*\n`;
            confirmText += `⏰ Алмазы будут зачислены в течение 5-15 минут`;

            await bot.sendMessage(chatId, confirmText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 Главное меню', callback_data: 'back_to_start' }]
                    ]
                }
            });

            // Помечаем купон как использованный
            if (orderData.couponData) {
                await db.collection('coupons').updateOne(
                    { _id: orderData.couponData._id },
                    {
                        $set: {
                            used: true,
                            usedAt: new Date(),
                            usedInOrder: orderId
                        }
                    }
                );
            }
        } else {
            confirmText += `💳 *Выберите способ оплаты:*\n`;
            confirmText += `⏰ Время выполнения: 5-15 минут\n`;
            confirmText += `✨ Автоматическое зачисление алмазов`;

            // Определяем способы оплаты по регионам
            let keyboard = [];

            if (orderData.region === 'RU') {
                // Россия: перевод, криптовалюта
                keyboard = [
                    [{ text: '💰 Перевод (Компаньон)', callback_data: `pay_transfer_${orderId}` }],
                    [{ text: '₿ Криптовалюта', callback_data: `pay_crypto_${orderId}` }],
                    [
                        { text: '❌ Отменить', callback_data: 'cancel_order' },
                        { text: '🔙 Изменить', callback_data: 'back_to_diamonds' }
                    ]
                ];
            } else {
                // Кыргызстан: O! Деньги, Balance.kg
                keyboard = [
                    [{ text: '📱 O! Деньги', callback_data: `pay_odengi_${orderId}` }],
                    [{ text: '💰 Balance.kg', callback_data: `pay_balance_${orderId}` }],
                    [
                        { text: '❌ Отменить', callback_data: 'cancel_order' },
                        { text: '🔙 Изменить', callback_data: 'back_to_diamonds' }
                    ]
                ];
            }

            await bot.sendMessage(chatId, confirmText, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        // Сохраняем заказ в базу данных
        if (db) {
            const ordersCollection = db.collection('orders');
            await ordersCollection.insertOne({
                chatId,
                orderId: orderId,
                diamond: orderData.diamond,
                playerId: orderData.playerId,
                serverId: orderData.serverId,
                region: orderData.region,
                originalPrice: orderData.diamond.price,
                finalPrice,
                currency,
                promoCode: orderData.promoCode,
                discount: orderData.discount,
                discountAmount: orderData.discountAmount,
                referralDiscount: orderData.referralDiscount || 0,
                isCoupon: orderData.isCoupon || false,
                couponCode: orderData.isCoupon ? orderData.promoCode : null,
                status: orderData.isCoupon ? 'confirmed' : 'awaiting_payment',
                createdAt: new Date()
            });

            // Если это купон - уведомляем админа сразу
            if (orderData.isCoupon && ADMIN_CHAT_ID) {
                const amountText = typeof orderData.diamond.amount === 'number'
                    ? `${orderData.diamond.amount} 💎`
                    : orderData.diamond.amount;

                const adminNotif =
                    `🎟️ *Заказ по купону*\n\n` +
                    `👤 *Клиент:* ${chatId}\n` +
                    `💎 *Товар:* ${amountText}\n` +
                    `🆔 *Player ID:* ${orderData.playerId}\n` +
                    `🌐 *Server ID:* ${orderData.serverId}\n` +
                    `🎫 *Купон:* ${orderData.promoCode}\n` +
                    `🔗 *Заказ:* ${orderId}\n\n` +
                    `✅ Зачислите алмазы!`;

                await bot.sendMessage(ADMIN_CHAT_ID, adminNotif, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '📱 Написать клиенту', url: `tg://user?id=${chatId}` }
                        ]]
                    }
                });
            }
        }

        // Очищаем временный заказ
        if (global.userOrders && global.userOrders[chatId]) {
            delete global.userOrders[chatId];
        }

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'payment_methods_shown', {
                orderId: orderId,
                amount: amountText,
                finalPrice,
                region: orderData.region,
                promoUsed: orderData.promoValid
            });
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error creating payment order:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка при создании заказа на оплату');
    }
}

// Обработка вывода реферальных бонусов
async function processWithdrawBonus(chatId, amount) {
    try {
        if (!referralService || !db) {
            await bot.sendMessage(chatId, '❌ Сервис недоступен');
            return;
        }

        const stats = await referralService.getReferralStats(chatId);
        if (!stats || stats.currentBonus < amount) {
            await bot.sendMessage(chatId, '❌ Недостаточно бонусов');
            return;
        }

        // Генерируем уникальный купон
        const couponCode = `BONUS${chatId}${Date.now().toString(36).toUpperCase()}`;

        // Создаем купон в базе данных
        const couponsCollection = db.collection('coupons');
        await couponsCollection.insertOne({
            code: couponCode,
            userId: chatId,
            diamondAmount: amount,
            type: 'referral_bonus',
            used: false,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 дней
        });

        // Списываем бонусы
        const usersCollection = db.collection('users');
        await usersCollection.updateOne(
            { chatId: chatId },
            { $inc: { referralBonus: -amount } }
        );

        // Отправляем купон пользователю
        const couponText =
            `🎉 *Купон успешно создан!*\n\n` +
            `🎟️ *Код купона:* \`${couponCode}\`\n` +
            `💎 *Номинал:* ${amount} алмазов\n` +
            `⏰ *Действителен:* 30 дней\n\n` +
            `📝 *Как использовать:*\n` +
            `1. Оформите заказ на любой пакет\n` +
            `2. Введите Player ID, Server ID и этот купон\n` +
            `3. Купон автоматически применится вместо оплаты\n\n` +
            `💡 Купон можно использовать только один раз`;

        await bot.sendMessage(chatId, couponText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💎 Оформить заказ', callback_data: 'buy_diamonds' }],
                    [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
                ]
            }
        });

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'bonus_withdrawn', {
                amount,
                couponCode
            });
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error processing withdraw bonus:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка при создании купона');
    }
}

// Создание инвойса через CryptoCloud
async function createCryptoCloudInvoice(order, orderId) {
    try {
        const axios = require('axios');

        // Конвертируем сумму в USD (примерный курс)
        const exchangeRate = order.currency === 'RUB' ? 0.011 : 0.012; // RUB и KGS к USD
        const amountUSD = (order.finalPrice * exchangeRate).toFixed(2);

        const invoiceData = {
            shop_id: CRYPTOCLOUD_SHOP_ID,
            amount: amountUSD,
            currency: 'USD',
            order_id: orderId,
            email: `user_${order.chatId}@telegram.bot`
        };

        console.log('🔐 Creating CryptoCloud invoice:', invoiceData);

        const response = await axios.post('https://api.cryptocloud.plus/v2/invoice/create', invoiceData, {
            headers: {
                'Authorization': `Token ${CRYPTOCLOUD_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ CryptoCloud invoice created:', response.data);

        if (response.data && response.data.status === 'success' && response.data.result) {
            return {
                pay_url: response.data.result.link,
                invoice_id: response.data.result.uuid
            };
        }

        return null;
    } catch (error) {
        console.error('❌ Error creating CryptoCloud invoice:', error.response?.data || error.message);
        if (logger && logger.error) {
            logger.error('CryptoCloud invoice creation failed:', error);
        }
        return null;
    }
}

// Обработка выбора способа оплаты
async function handlePaymentMethod(chatId, messageId, paymentData) {
    console.log('🔍 handlePaymentMethod called:', {
        chatId,
        messageId,
        paymentData
    });
    try {
        const parts = paymentData.split('_');
        console.log('📊 Parsed payment data:', { paymentMethod: parts[1], orderId: parts.slice(2).join('_') });
        const paymentMethod = parts[1]; // transfer, crypto, odengi, balance
        const orderId = parts.slice(2).join('_'); // ID заказа

        // Получаем заказ из базы данных
        if (!db) {
            console.log('❌ Database not available');
            await bot.sendMessage(chatId, '❌ База данных недоступна');
            return;
        }

        const ordersCollection = db.collection('orders');
        const order = await ordersCollection.findOne({ orderId: orderId, chatId: chatId });

        console.log('🔍 Order lookup result:', { found: !!order, orderId, chatId });

        if (!order) {
            console.log('❌ Order not found in database');
            await bot.sendMessage(chatId, '❌ Заказ не найден. Пожалуйста, начните заказ заново.');
            return;
        }


        let paymentText = '';
        let paymentInstructions = '';
        let keyboard = [];

        switch (paymentMethod) {
            case 'transfer':
                paymentText = `💰 Перевод через Компаньон Банк\n\n`;
                paymentText += `💰 К оплате: ${order.finalPrice} ${order.currency}\n`;
                paymentText += `🔗 Заказ: ${orderId}\n\n`;
                paymentInstructions = `📝 Инструкция:\n`;
                paymentInstructions += `1. Переведите ${order.finalPrice} ${order.currency} на номер\n`;
                paymentInstructions += `📞 +996 707 711 770 (Компаньон Банк)\n`;
                paymentInstructions += `2. Нажмите "Я оплатил" и отправьте скриншот\n\n`;
                paymentInstructions += `⏰ Алмазы поступят после подтверждения админом`;

                keyboard = [
                    [{ text: '✅ Я оплатил', callback_data: `paid_${orderId}` }],
                    [{ text: '📱 Связаться с админом', url: `tg://user?id=${ADMIN_CHAT_ID}` }],
                    [{ text: '🔙 Назад', callback_data: 'back_to_diamonds' }]
                ];
                break;

            case 'crypto':
                // Создаем инвойс через CryptoCloud
                const cryptoInvoice = await createCryptoCloudInvoice(order, orderId);

                if (cryptoInvoice && cryptoInvoice.pay_url) {
                    paymentText = `₿ Оплата криптовалютой\n\n`;
                    paymentText += `💰 К оплате: ${order.finalPrice} ${order.currency}\n`;
                    paymentText += `🔗 Заказ: ${orderId}\n\n`;
                    paymentInstructions = `📝 Инструкция:\n`;
                    paymentInstructions += `1. Нажмите "Оплатить криптой"\n`;
                    paymentInstructions += `2. Выберите криптовалюту (BTC, ETH, USDT и др.)\n`;
                    paymentInstructions += `3. Переведите указанную сумму\n`;
                    paymentInstructions += `4. Алмазы зачислятся автоматически\n\n`;
                    paymentInstructions += `⏰ Обычно занимает 5-15 минут`;

                    keyboard = [
                        [{ text: '₿ Оплатить криптой', url: cryptoInvoice.pay_url }],
                        [{ text: '📱 Связаться с админом', url: `tg://user?id=${ADMIN_CHAT_ID}` }],
                        [{ text: '🔙 Назад', callback_data: 'back_to_diamonds' }]
                    ];
                } else {
                    // Если не удалось создать инвойс
                    paymentText = `₿ Оплата криптовалютой\n\n`;
                    paymentText += `💰 К оплате: ${order.finalPrice} ${order.currency}\n`;
                    paymentText += `🔗 Заказ: ${orderId}\n\n`;
                    paymentInstructions = `⚠️ Временные технические проблемы.\n`;
                    paymentInstructions += `Пожалуйста, свяжитесь с администратором для оплаты.`;

                    keyboard = [
                        [{ text: '📱 Связаться с админом', url: `tg://user?id=${ADMIN_CHAT_ID}` }],
                        [{ text: '🔙 Назад', callback_data: 'back_to_diamonds' }]
                    ];
                }
                break;

            case 'odengi':
                paymentText = `📱 Оплата через O! Деньги\n\n`;
                paymentText += `💰 К оплате: ${order.finalPrice} ${order.currency}\n`;
                paymentText += `🔗 Заказ: ${orderId}\n\n`;
                paymentInstructions = `📝 Инструкция:\n`;
                paymentInstructions += `1. Переведите ${order.finalPrice} ${order.currency} на номер:\n`;
                paymentInstructions += `📞 +996 707 711 770 (O! Деньги)\n`;
                paymentInstructions += `2. Нажмите "Я оплатил" и отправьте скриншот\n\n`;
                paymentInstructions += `⏰ Алмазы поступят после подтверждения админом`;

                keyboard = [
                    [{ text: '✅ Я оплатил', callback_data: `paid_${orderId}` }],
                    [{ text: '📱 Связаться с админом', url: `tg://user?id=${ADMIN_CHAT_ID}` }],
                    [{ text: '🔙 Назад', callback_data: 'back_to_diamonds' }]
                ];
                break;

            case 'balance':
                paymentText = `💰 Оплата через Balance.kg\n\n`;
                paymentText += `💰 К оплате: ${order.finalPrice} ${order.currency}\n`;
                paymentText += `🔗 Заказ: ${orderId}\n\n`;
                paymentInstructions = `📝 Инструкция:\n`;
                paymentInstructions += `1. Переведите ${order.finalPrice} ${order.currency} на номер:\n`;
                paymentInstructions += `📞 +996 221 577 629 (Balance.kg)\n`;
                paymentInstructions += `2. Нажмите "Я оплатил" и отправьте скриншот\n\n`;
                paymentInstructions += `⏰ Алмазы поступят после подтверждения админом`;

                keyboard = [
                    [{ text: '✅ Я оплатил', callback_data: `paid_${orderId}` }],
                    [{ text: '📱 Связаться с админом', url: `tg://user?id=${ADMIN_CHAT_ID}` }],
                    [{ text: '🔙 Назад', callback_data: 'back_to_diamonds' }]
                ];
                break;

            default:
                await bot.sendMessage(chatId, '❌ Неизвестный способ оплаты');
                return;
        }

        const fullText = paymentText + paymentInstructions;

        console.log('📝 Sending payment instructions for method:', paymentMethod);
        console.log('💬 Message length:', fullText.length);

        // Удаляем старое сообщение и отправляем новое для надежности
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (deleteError) {
            console.log('⚠️ Could not delete message, trying to edit instead');
        }

        // Отправляем новое сообщение с инструкциями по оплате
        await bot.sendMessage(chatId, fullText, {
            reply_markup: { inline_keyboard: keyboard }
        });

        console.log('✅ Payment instructions sent successfully');

        // Обновляем статус заказа
        await ordersCollection.updateOne(
            { orderId: orderId },
            {
                $set: {
                    status: 'payment_instructions_sent',
                    paymentMethod: paymentMethod,
                    updatedAt: new Date()
                }
            }
        );

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'payment_method_selected', {
                orderId,
                method: paymentMethod,
                amount: order.finalPrice
            });
        }

    } catch (error) {
        console.error('❌ Error in handlePaymentMethod:', error);
        if (logger && logger.error) {
            logger.error('Error handling payment method:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка при обработке способа оплаты. Попробуйте еще раз.');
    }
}

// Обработка подтверждения оплаты клиентом
async function handlePaymentConfirmation(chatId, messageId, callbackData) {
    try {
        const orderId = callbackData.replace('paid_', '');

        // Получаем заказ из базы данных
        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна');
            return;
        }

        const ordersCollection = db.collection('orders');
        const order = await ordersCollection.findOne({ orderId: orderId, chatId: chatId });

        if (!order) {
            await bot.sendMessage(chatId, '❌ Заказ не найден');
            return;
        }

        if (order.status !== 'payment_instructions_sent') {
            await bot.sendMessage(chatId, '❌ Заказ уже обработан или отменен');
            return;
        }

        // Обновляем статус заказа
        await ordersCollection.updateOne(
            { orderId: orderId },
            {
                $set: {
                    status: 'payment_claimed',
                    claimedAt: new Date()
                }
            }
        );

        // Отправляем инструкцию клиенту
        const confirmText =
            `✅ Платеж отмечен как выполненный!\n\n` +
            `🔗 Заказ: ${orderId}\n` +
            `💰 Сумма: ${order.finalPrice} ${order.currency}\n\n` +
            `📸 Теперь отправьте скриншот оплаты:\n` +
            `• Скриншот чека или перевода\n` +
            `• Четко видны сумма и номер заказа\n` +
            `• Один файл изображения\n\n` +
            `⏰ Админ проверит платеж и зачислит алмазы`;

        const keyboard = [
            [{ text: '📱 Связаться с админом', url: `tg://user?id=${ADMIN_CHAT_ID}` }],
            [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
        ];

        // Удаляем старое сообщение и отправляем новое
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (deleteError) {
            console.log('⚠️ Could not delete message in payment confirmation');
        }

        await bot.sendMessage(chatId, confirmText, {
            reply_markup: { inline_keyboard: keyboard }
        });

        // Устанавливаем режим ожидания скриншота
        if (!global.awaitingScreenshots) global.awaitingScreenshots = {};
        global.awaitingScreenshots[chatId] = {
            orderId: orderId,
            order: order,
            timestamp: new Date()
        };

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'payment_claimed', {
                orderId,
                amount: order.finalPrice,
                method: order.paymentMethod
            });
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error handling payment confirmation:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка при обработке подтверждения оплаты');
    }
}

// Обработка скриншота оплаты
async function processPaymentScreenshot(msg) {
    try {
        const chatId = msg.chat.id;
        const screenshotInfo = global.awaitingScreenshots[chatId];

        if (!screenshotInfo) {
            await bot.sendMessage(chatId, '❌ Не найден активный заказ для загрузки скриншота');
            return;
        }

        const { orderId, order } = screenshotInfo;

        // Получаем файл фотографии
        const photo = msg.photo[msg.photo.length - 1]; // Берем самое высокое качество
        const fileId = photo.file_id;

        // Обновляем заказ в базе данных
        if (db) {
            const ordersCollection = db.collection('orders');
            await ordersCollection.updateOne(
                { orderId: orderId },
                {
                    $set: {
                        status: 'screenshot_uploaded',
                        screenshotFileId: fileId,
                        screenshotUploadedAt: new Date()
                    }
                }
            );
        }

        // Уведомляем клиента
        await bot.sendMessage(chatId,
            `✅ Скриншот получен!\n\n` +
            `🔗 Заказ: ${orderId}\n` +
            `⏰ Админ проверит платеж и зачислит алмазы в течение 15 минут\n\n` +
            `📱 При необходимости админ свяжется с вами`
        );

        // Отправляем админу уведомление с данными заказа и скриншотом
        await sendAdminNotification(order, fileId, msg.from);

        // Очищаем состояние ожидания скриншота
        delete global.awaitingScreenshots[chatId];

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'screenshot_uploaded', {
                orderId,
                fileId
            });
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error processing payment screenshot:', error);
        }
        await bot.sendMessage(msg.chat.id, '❌ Ошибка при обработке скриншота');
    }
}

// Отправка уведомления админу
async function sendAdminNotification(order, screenshotFileId, userInfo) {
    try {
        const amountText = typeof order.diamond.amount === 'number'
            ? `${order.diamond.amount} 💎`
            : order.diamond.amount;

        let adminText = `🔔 *НОВЫЙ ПЛАТЕЖ*\n\n`;
        adminText += `👤 *Клиент:* ${userInfo.first_name || 'Неизвестно'} ${userInfo.last_name || ''}`;
        if (userInfo.username) {
            adminText += ` (@${userInfo.username})`;
        }
        adminText += `\n`;
        adminText += `💬 *Chat ID:* ${order.chatId}\n\n`;
        adminText += `🔗 *Заказ:* \`${order.orderId}\`\n`;
        adminText += `💎 *Товар:* ${amountText}\n`;
        adminText += `👤 *Player ID:* \`${order.playerId}\`\n`;
        adminText += `🌐 *Server ID:* \`${order.serverId}\`\n`;
        adminText += `🌍 *Регион:* ${order.region === 'RU' ? '🇷🇺 Россия' : '🇰🇬 Кыргызстан'}\n`;
        adminText += `💳 *Способ:* ${getPaymentMethodName(order.paymentMethod)}\n`;
        adminText += `💰 *Сумма:* ${order.finalPrice} ${order.currency}\n`;

        if (order.promoCode) {
            adminText += `🎫 *Промокод:* ${order.promoCode} (-${order.discount}%)\n`;
        }

        const keyboard = [
            [
                { text: '✅ Подтвердить', callback_data: `confirm_${order.orderId}` },
                { text: '❌ Отклонить', callback_data: `reject_${order.orderId}` }
            ],
            [{ text: '📱 Написать клиенту', url: `tg://user?id=${order.chatId}` }]
        ];

        // Отправляем скриншот с данными заказа
        await bot.sendPhoto(ADMIN_CHAT_ID, screenshotFileId, {
            caption: adminText,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });

        if (logger && logger.userAction) {
            logger.userAction(ADMIN_CHAT_ID, 'admin_notification_sent', {
                orderId: order.orderId,
                clientId: order.chatId,
                amount: order.finalPrice
            });
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error sending admin notification:', error);
        }
    }
}

// Вспомогательная функция для получения названия способа оплаты
function getPaymentMethodName(method) {
    switch (method) {
        case 'transfer': return 'Компаньон Банк';
        case 'crypto': return 'Криптовалюта';
        case 'odengi': return 'O! Деньги';
        case 'balance': return 'Balance.kg';
        default: return method;
    }
}

// Обработка решения админа (подтверждение/отклонение)
async function handleAdminDecision(chatId, messageId, callbackData) {
    try {
        // Проверяем, что это админ
        if (chatId.toString() !== ADMIN_CHAT_ID) {
            await bot.answerCallbackQuery(chatId, '❌ Доступ запрещен');
            return;
        }

        const isConfirm = callbackData.startsWith('confirm_');
        const orderId = callbackData.replace(isConfirm ? 'confirm_' : 'reject_', '');

        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна');
            return;
        }

        const ordersCollection = db.collection('orders');
        const order = await ordersCollection.findOne({ orderId: orderId });

        if (!order) {
            await bot.sendMessage(chatId, '❌ Заказ не найден');
            return;
        }

        if (order.status !== 'screenshot_uploaded') {
            await bot.sendMessage(chatId, '❌ Заказ уже обработан или имеет неверный статус');
            return;
        }

        const clientChatId = order.chatId;
        let clientMessage = '';
        let adminMessage = '';
        let newStatus = '';

        if (isConfirm) {
            // Подтверждение платежа
            newStatus = 'confirmed';
            adminMessage = `✅ Платеж подтвержден\n\nЗаказ: ${orderId}\nАлмазы будут зачислены в игру`;

            const amountText = typeof order.diamond.amount === 'number'
                ? `${order.diamond.amount} 💎`
                : order.diamond.amount;

            clientMessage =
                `🎉 Платеж подтвержден!\n\n` +
                `💎 Товар: ${amountText}\n` +
                `👤 Player ID: ${order.playerId}\n` +
                `🌐 Server ID: ${order.serverId}\n\n` +
                `✨ Алмазы будут зачислены в течение 5-15 минут!\n` +
                `📱 При возникновении проблем обращайтесь к админу`;

            // Начисляем реферальные бонусы
            if (referralService) {
                try {
                    const bonusResult = await referralService.processReferralBonus(
                        clientChatId,
                        order.originalPrice,
                        order.currency
                    );
                    if (bonusResult.success && logger && logger.info) {
                        logger.info('Referral bonus processed', {
                            buyer: clientChatId,
                            referrer: bonusResult.referrerId,
                            bonus: bonusResult.bonus
                        });
                    }
                } catch (error) {
                    if (logger && logger.error) {
                        logger.error('Error processing referral bonus:', error);
                    }
                }
            }

            // Обновляем статистику пользователя
            const usersCollection = db.collection('users');
            await usersCollection.updateOne(
                { chatId: clientChatId },
                {
                    $inc: {
                        purchases: 1,
                        totalSpent: order.finalPrice
                    },
                    $set: {
                        lastPurchase: new Date()
                    }
                },
                { upsert: true }
            );

        } else {
            // Отклонение платежа
            newStatus = 'rejected';
            adminMessage = `❌ Платеж отклонен\n\nЗаказ: ${orderId}\nКлиент уведомлен`;

            clientMessage =
                `❌ Платеж отклонен\n\n` +
                `🔗 Заказ: ${orderId}\n` +
                `💰 Сумма: ${order.finalPrice} ${order.currency}\n\n` +
                `📝 Возможные причины:\n` +
                `• Неверная сумма платежа\n` +
                `• Не указан номер заказа\n` +
                `• Некачественный скриншот\n\n` +
                `📱 Обратитесь к админу для уточнения`;
        }

        // Обновляем заказ в базе данных
        await ordersCollection.updateOne(
            { orderId: orderId },
            {
                $set: {
                    status: newStatus,
                    adminDecision: isConfirm ? 'confirmed' : 'rejected',
                    adminDecisionAt: new Date(),
                    adminChatId: chatId
                }
            }
        );

        // Отправляем сообщения
        await bot.sendMessage(clientChatId, clientMessage);

        // Обновляем сообщение админа
        await safeEditMessage(chatId, messageId, adminMessage, {
            reply_markup: { inline_keyboard: [[{ text: '📱 Написать клиенту', url: `tg://user?id=${clientChatId}` }]] }
        });

        if (logger && logger.userAction) {
            logger.userAction(chatId, isConfirm ? 'payment_confirmed' : 'payment_rejected', {
                orderId,
                clientId: clientChatId,
                amount: order.finalPrice
            });
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error handling admin decision:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка при обработке решения');
    }
}

// Обработчики команд
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const referralCode = match[1] ? match[1].trim() : null;

    if (logger && logger.userAction) {
        logger.userAction(chatId, 'bot_started', { referralCode });
    }

    // Автоматически создаем реферальный код для каждого пользователя
    if (referralService) {
        try {
            await referralService.createReferralCode(chatId);
        } catch (error) {
            logger.error('Error creating referral code:', error);
        }
    }

    if (referralCode && referralService) {
        try {
            const result = await referralService.activateReferral(referralCode, chatId);
            if (result.success) {
                await bot.sendMessage(chatId, '🎉 Вы успешно активировали реферальный код! Скидка 5% на первую покупку!');
            }
        } catch (error) {
            logger.error('Error activating referral:', error);
        }
    }

    await showMainMenu(chatId);
});

// Команда статистики для админа
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;

    // Проверяем, что это админ
    if (chatId.toString() !== ADMIN_CHAT_ID) {
        await bot.sendMessage(chatId, '❌ Доступ запрещен');
        return;
    }

    try {
        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна');
            return;
        }

        const usersCollection = db.collection('users');
        const ordersCollection = db.collection('orders');
        const referralsCollection = db.collection('referrals');
        const couponsCollection = db.collection('coupons');

        // Общая статистика пользователей
        const totalUsers = await usersCollection.countDocuments();
        const usersWithPurchases = await usersCollection.countDocuments({ purchases: { $gt: 0 } });
        const usersWithReferrals = await usersCollection.countDocuments({ referredBy: { $exists: true } });

        // Статистика заказов
        const totalOrders = await ordersCollection.countDocuments();
        const confirmedOrders = await ordersCollection.countDocuments({ status: 'confirmed' });
        const pendingOrders = await ordersCollection.countDocuments({ status: 'awaiting_payment' });
        const paidOrders = await ordersCollection.countDocuments({ status: 'paid' });

        // Финансовая статистика
        const confirmedOrdersData = await ordersCollection.find({ status: 'confirmed' }).toArray();
        let totalRevenue = 0;
        let totalCost = 0;
        confirmedOrdersData.forEach(order => {
            totalRevenue += order.finalPrice || 0;
            // Находим себестоимость из DIAMONDS_DATA
            const diamondsData = order.region === 'RU' ? DIAMONDS_DATA_RU : DIAMONDS_DATA_KG;
            const diamond = diamondsData.find(d => d.amount === order.diamondAmount);
            if (diamond) {
                totalCost += diamond.cost || 0;
            }
        });
        const totalProfit = totalRevenue - totalCost;

        // Реферальная статистика
        const totalReferrals = await referralsCollection.countDocuments();
        const referralBonusesPaid = await referralsCollection.aggregate([
            { $group: { _id: null, total: { $sum: '$bonusAwarded' } } }
        ]).toArray();
        const totalReferralBonuses = referralBonusesPaid.length > 0 ? referralBonusesPaid[0].total : 0;

        // Статистика купонов
        const totalCoupons = await couponsCollection.countDocuments();
        const usedCoupons = await couponsCollection.countDocuments({ used: true });
        const activeCoupons = await couponsCollection.countDocuments({ used: false, expiresAt: { $gt: new Date() } });

        // Топ покупателей
        const topBuyers = await usersCollection.find({ purchases: { $gt: 0 } })
            .sort({ totalSpent: -1 })
            .limit(5)
            .toArray();

        // Топ рефереров
        const topReferrers = await usersCollection.find({ totalReferralEarnings: { $gt: 0 } })
            .sort({ totalReferralEarnings: -1 })
            .limit(5)
            .toArray();

        // Формируем сообщение
        let statsText = `📊 *РАСШИРЕННАЯ СТАТИСТИКА*\n\n`;

        statsText += `👥 *ПОЛЬЗОВАТЕЛИ*\n`;
        statsText += `• Всего: ${totalUsers}\n`;
        statsText += `• С покупками: ${usersWithPurchases} (${((usersWithPurchases / totalUsers) * 100).toFixed(1)}%)\n`;
        statsText += `• Пришли по рефералам: ${usersWithReferrals}\n\n`;

        statsText += `📦 *ЗАКАЗЫ*\n`;
        statsText += `• Всего: ${totalOrders}\n`;
        statsText += `• Выполнено: ${confirmedOrders}\n`;
        statsText += `• Ожидают оплаты: ${pendingOrders}\n`;
        statsText += `• Оплачено (ждут подтверждения): ${paidOrders}\n`;
        statsText += `• Конверсия: ${totalUsers > 0 ? ((confirmedOrders / totalUsers) * 100).toFixed(1) : 0}%\n\n`;

        statsText += `💰 *ФИНАНСЫ*\n`;
        statsText += `• Выручка: ${totalRevenue.toFixed(2)} руб\n`;
        statsText += `• Себестоимость: ${totalCost.toFixed(2)} руб\n`;
        statsText += `• Прибыль: ${totalProfit.toFixed(2)} руб\n`;
        statsText += `• Рентабельность: ${totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : 0}%\n\n`;

        statsText += `🎁 *РЕФЕРАЛЬНАЯ ПРОГРАММА*\n`;
        statsText += `• Всего рефералов: ${totalReferrals}\n`;
        statsText += `• Выплачено бонусов: ${totalReferralBonuses} алмазов\n\n`;

        statsText += `🎟️ *КУПОНЫ*\n`;
        statsText += `• Всего создано: ${totalCoupons}\n`;
        statsText += `• Использовано: ${usedCoupons}\n`;
        statsText += `• Активных: ${activeCoupons}\n\n`;

        if (topBuyers.length > 0) {
            statsText += `🏆 *ТОП-5 ПОКУПАТЕЛЕЙ*\n`;
            topBuyers.forEach((user, index) => {
                statsText += `${index + 1}. ID ${user.chatId} - ${user.totalSpent?.toFixed(2) || 0} руб (${user.purchases || 0} покупок)\n`;
            });
            statsText += `\n`;
        }

        if (topReferrers.length > 0) {
            statsText += `👥 *ТОП-5 РЕФЕРЕРОВ*\n`;
            topReferrers.forEach((user, index) => {
                statsText += `${index + 1}. ID ${user.chatId} - ${user.totalReferralEarnings || 0} алмазов заработано\n`;
            });
        }

        await bot.sendMessage(chatId, statsText, {
            parse_mode: 'Markdown'
        });

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'admin_stats_viewed');
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error showing admin stats:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка получения статистики');
    }
});

// Команда создания купона для админа
bot.onText(/\/createcoupon (\d+) (\S+)(?: (\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    // Проверяем, что это админ
    if (chatId.toString() !== ADMIN_CHAT_ID) {
        await bot.sendMessage(chatId, '❌ Доступ запрещен');
        return;
    }

    try {
        const diamondAmount = parseInt(match[1]);
        const customCode = match[2];
        const quantity = match[3] ? parseInt(match[3]) : 1;

        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна');
            return;
        }

        // Проверяем лимит
        if (quantity > 1000) {
            await bot.sendMessage(chatId, '❌ Максимум 1000 купонов за раз');
            return;
        }

        // Проверяем, что такой пакет существует
        const allDiamonds = [...DIAMONDS_DATA_RU, ...DIAMONDS_DATA_KG];
        const packageExists = allDiamonds.some(d => d.amount === diamondAmount);

        if (!packageExists) {
            await bot.sendMessage(chatId, `❌ Пакет на ${diamondAmount} алмазов не существует`);
            return;
        }

        const couponsCollection = db.collection('coupons');

        // Создаем купоны
        const coupons = [];
        for (let i = 0; i < quantity; i++) {
            coupons.push({
                code: customCode,
                userId: null,
                diamondAmount: diamondAmount,
                type: 'admin_created',
                used: false,
                maxUses: quantity, // Количество использований
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
        }

        await couponsCollection.insertMany(coupons);

        const confirmText =
            `✅ *Купоны созданы успешно!*\n\n` +
            `🎟️ *Код:* \`${customCode}\`\n` +
            `💎 *Номинал:* ${diamondAmount} алмазов\n` +
            `📦 *Количество:* ${quantity} шт\n` +
            `⏰ *Действительны:* 30 дней\n\n` +
            `Купон "${customCode}" может быть использован ${quantity} раз`;

        await bot.sendMessage(chatId, confirmText, { parse_mode: 'Markdown' });

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'admin_coupons_created', { code: customCode, amount: diamondAmount, quantity });
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error creating admin coupon:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка создания купонов');
    }
});

// Команда сброса статистики для админа
bot.onText(/\/resetstats/, async (msg) => {
    const chatId = msg.chat.id;

    // Проверяем, что это админ
    if (chatId.toString() !== ADMIN_CHAT_ID) {
        await bot.sendMessage(chatId, '❌ Доступ запрещен');
        return;
    }

    try {
        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна');
            return;
        }

        // Запрашиваем подтверждение
        const confirmText =
            `⚠️ *ВНИМАНИЕ!*\n\n` +
            `Вы действительно хотите сбросить всю статистику?\n\n` +
            `Это удалит:\n` +
            `• Всех пользователей\n` +
            `• Все заказы\n` +
            `• Все промокоды\n` +
            `• Все купоны\n` +
            `• Всю реферальную информацию\n\n` +
            `*Это действие необратимо!*`;

        await bot.sendMessage(chatId, confirmText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Да, сбросить', callback_data: 'confirm_reset_stats' },
                        { text: '❌ Отмена', callback_data: 'cancel_reset_stats' }
                    ]
                ]
            }
        });

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error showing reset confirmation:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка');
    }
});

// Команда создания промокода для админа
bot.onText(/\/createpromo (\S+) (\d+)(?: (\d+))?(?: (\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    // Проверяем, что это админ
    if (chatId.toString() !== ADMIN_CHAT_ID) {
        await bot.sendMessage(chatId, '❌ Доступ запрещен');
        return;
    }

    try {
        const promoCode = match[1].toUpperCase();
        const discount = parseInt(match[2]);
        const maxUses = match[3] ? parseInt(match[3]) : 100;
        const minOrderAmount = match[4] ? parseInt(match[4]) : 0;

        if (!promoService || !db) {
            await bot.sendMessage(chatId, '❌ Сервис недоступен');
            return;
        }

        // Проверяем корректность скидки
        if (discount < 1 || discount > 50) {
            await bot.sendMessage(chatId, '❌ Скидка должна быть от 1% до 50%');
            return;
        }

        // Создаем промокод через PromoService
        const result = await promoService.createPromo(chatId, {
            code: promoCode,
            discount: discount,
            type: 'percentage',
            maxUses: maxUses,
            minOrderAmount: minOrderAmount,
            validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 дней
            description: 'Создан администратором через команду'
        });

        if (!result.success) {
            await bot.sendMessage(chatId, `❌ ${result.error}`);
            return;
        }

        const confirmText =
            `✅ *Промокод создан успешно!*\n\n` +
            `🎫 *Код:* \`${promoCode}\`\n` +
            `💰 *Скидка:* ${discount}%\n` +
            `📦 *Максимум использований:* ${maxUses} раз\n` +
            `💵 *Минимальная сумма заказа:* ${minOrderAmount > 0 ? minOrderAmount : 'нет ограничений'}\n` +
            `⏰ *Действителен:* 30 дней\n\n` +
            `Пользователи могут использовать промокод при оформлении заказа`;

        await bot.sendMessage(chatId, confirmText, { parse_mode: 'Markdown' });

        if (logger && logger.userAction) {
            logger.userAction(chatId, 'admin_promo_created', { code: promoCode, discount, maxUses, minOrderAmount });
        }

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Error creating admin promo:', error);
        }
        await bot.sendMessage(chatId, '❌ Ошибка создания промокода');
    }
});

// Обработчик сообщений для заказов и скриншотов
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Игнорируем команды от ботов
    if (msg.from.is_bot) return;

    // Обработка фотографий (скриншотов оплаты)
    if (msg.photo && global.awaitingScreenshots && global.awaitingScreenshots[chatId]) {
        await processPaymentScreenshot(msg);
        return;
    }

    // Обработка текстовых сообщений для заказов
    if (text && !text.startsWith('/')) {
        // Проверяем, есть ли активный заказ для пользователя
        if (global.userOrders && global.userOrders[chatId]) {
            await processOrderInput(chatId, text);
        }
    }
});

// Обработчик callback запросов
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    try {
        console.log('🔍 Callback query received:', { chatId, data: q.data });
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
                    const botUsername = (await bot.getMe()).username;
                    const shareText = `🎁 Получите скидку 5% на алмазы MLBB!\n\nПрисоединяйтесь по моей ссылке: https://t.me/${botUsername}?start=${stats.referralCode}`;
                    await bot.sendMessage(chatId, shareText);
                }
            }
        } else if (q.data === 'withdraw_bonus') {
            await showWithdrawBonusMenu(chatId, messageId);
        } else if (q.data.startsWith('withdraw_')) {
            const amount = parseInt(q.data.split('_')[1]);
            await processWithdrawBonus(chatId, amount);
        } else if (q.data === 'confirm_reset_stats') {
            // Сброс статистики
            if (chatId.toString() === ADMIN_CHAT_ID && db) {
                try {
                    await db.collection('users').deleteMany({});
                    await db.collection('orders').deleteMany({});
                    await db.collection('promos').deleteMany({});
                    await db.collection('promo_usage').deleteMany({});
                    await db.collection('coupons').deleteMany({});
                    await db.collection('referrals').deleteMany({});

                    await bot.editMessageText(
                        '✅ *Статистика успешно сброшена!*\n\nВсе данные удалены из базы.',
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown'
                        }
                    );

                    if (logger && logger.userAction) {
                        logger.userAction(chatId, 'stats_reset');
                    }
                } catch (error) {
                    if (logger && logger.error) {
                        logger.error('Error resetting stats:', error);
                    }
                    await bot.sendMessage(chatId, '❌ Ошибка сброса статистики');
                }
            }
        } else if (q.data === 'cancel_reset_stats') {
            await bot.editMessageText(
                '❌ Сброс статистики отменен',
                {
                    chat_id: chatId,
                    message_id: messageId
                }
            );
        } else if (q.data === 'back_to_start') {
            await showMainMenu(chatId, messageId);
        } else if (q.data.startsWith('region_')) {
            const region = q.data.split('_')[1].toUpperCase();
            selectedRegion = region;
            await showDiamondsMenu(chatId, messageId);
        } else if (q.data === 'back_to_regions') {
            await showRegionMenu(chatId, messageId);
        } else if (q.data === 'back_to_diamonds') {
            await showDiamondsMenu(chatId, messageId);
        } else if (q.data === 'cancel_order') {
            // Очищаем активный заказ
            console.log('🗑️ Canceling order for user:', chatId);
            if (global.userOrders && global.userOrders[chatId]) {
                delete global.userOrders[chatId];
            }
            await bot.sendMessage(chatId, '❌ Заказ отменен');
            await showMainMenu(chatId);
        } else if (q.data.startsWith('pay_')) {
            console.log('💳 Payment method button clicked:', q.data);
            await handlePaymentMethod(chatId, messageId, q.data);
        } else if (q.data.startsWith('paid_')) {
            console.log('✅ Payment confirmation button clicked:', q.data);
            await handlePaymentConfirmation(chatId, messageId, q.data);
        } else if (q.data.startsWith('confirm_') || q.data.startsWith('reject_')) {
            await handleAdminDecision(chatId, messageId, q.data);
        } else if (q.data.startsWith('diamond_')) {
            const diamondIndex = parseInt(q.data.split('_')[1]);
            await showOrderForm(chatId, messageId, diamondIndex);
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