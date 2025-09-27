// Импортируем необходимые модули
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const axios = require('axios');

// Создаем Express приложение
const app = express();

// Переменные для базы данных и бота
let db;
let bot;

// Глобальные переменные
const waitingForAction = {};

// Данные о алмазах (добавьте ваши реальные данные)
const diamondsDataRU = [
    { amount: 86, price: 65 },
    { amount: 172, price: 129 },
    { amount: 257, price: 194 },
    { amount: 344, price: 259 },
    { amount: 429, price: 323 }
];

const diamondsDataKG = [
    { amount: 86, price: 79 },
    { amount: 172, price: 159 },
    { amount: 257, price: 239 },
    { amount: 344, price: 319 },
    { amount: 429, price: 399 }
];

console.log('🔍 Checking environment variables:');
console.log('TOKEN exists:', !!process.env.TOKEN);
console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('CRYPTOCLOUD_API_KEY exists:', !!process.env.CRYPTOCLOUD_API_KEY);
console.log('WEBHOOK_URL:', process.env.WEBHOOK_URL);

// Настройка Express для Render
const PORT = process.env.PORT || 3000;

// Обязательные роуты для Render
app.get('/', (req, res) => {
    res.json({ 
        status: 'Bot is running',
        timestamp: new Date().toISOString(),
        message: 'Telegram bot server is active'
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', uptime: process.uptime() });
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.removeHeader('X-Powered-By');
    next();
});

// Инициализация бота и базы данных
async function initializeBot() {
    try {
        // Подключение к базе данных
        if (process.env.MONGO_URI) {
            const client = new MongoClient(process.env.MONGO_URI);
            await client.connect();
            db = client.db();
            console.log('✅ Connected to MongoDB');
        }

        // Создание бота
        if (process.env.TOKEN) {
            bot = new TelegramBot(process.env.TOKEN, { polling: true });
            console.log('✅ Bot initialized');
            
            // Настройка обработчиков
            setupBotHandlers();
        }
        
    } catch (error) {
        console.error('❌ Initialization error:', error);
    }
}

// Система уровней лояльности с разумными бонусами
function getLoyaltyInfo(purchases) {
    let level, emoji, benefits, nextLevel, discount, bonusFrequency;
    
    if (purchases >= 50) {
        level = 'Легенда';
        emoji = '👑';
        discount = 0;
        bonusFrequency = 4;
        benefits = [
            '🎁 Бонус каждые 4 покупки',
            '🎟️ 3 использования скидки 10%',
            '⚡ Приоритетная обработка заказов',
            '🎉 Эксклюзивные промокоды',
            '👑 Статус "Легенда"',
            '📞 Персональная поддержка'
        ];
        nextLevel = null;
    } else if (purchases >= 20) {
        level = 'VIP клиент';
        emoji = '💎';
        discount = 0;
        bonusFrequency = 4;
        benefits = [
            '🎁 Бонус каждые 4 покупки',
            '🎟️ 3 использования скидки 7%',
            '⚡ Быстрая обработка заказов',
            '🎯 Специальные предложения'
        ];
        nextLevel = { name: 'Легенда', need: 50 - purchases };
    } else if (purchases >= 10) {
        level = 'Постоянный клиент';
        emoji = '⭐';
        discount = 0;
        bonusFrequency = 5;
        benefits = [
            '🎁 Стандартные бонусы (каждые 5 покупок)',
            '🎟️ 2 использования скидки 5%',
            '📱 Улучшенная поддержка'
        ];
        nextLevel = { name: 'VIP клиент', need: 20 - purchases };
    } else if (purchases >= 5) {
        level = 'Активный покупатель';
        emoji = '🔥';
        discount = 0;
        bonusFrequency = 5;
        benefits = [
            '🎁 Стандартные бонусы (каждые 5 покупок)',
            '🎟️ 1 использование скидки 3%',
            '🌟 Доступ к акциям'
        ];
        nextLevel = { name: 'Постоянный клиент', need: 10 - purchases };
    } else if (purchases >= 1) {
        level = 'Новичок';
        emoji = '🌱';
        discount = 0;
        bonusFrequency = 5;
        benefits = [
            '🎁 Бонус после 5 покупок',
            '📚 Обучающие материалы',
            '💬 Базовая поддержка'
        ];
        nextLevel = { name: 'Активный покупатель', need: 5 - purchases };
    } else {
        level = 'Гость';
        emoji = '👋';
        discount = 0;
        bonusFrequency = 5;
        benefits = [
            '🎯 Первая покупка = старт пути',
            '📖 Ознакомление с сервисом'
        ];
        nextLevel = { name: 'Новичок', need: 1 };
    }
    
    return { level, emoji, benefits, nextLevel, discount, bonusFrequency };
}

// Система лимитированных скидок
async function getUserDiscountInfo(chatId) {
    try {
        if (!db) return { active_3: 0, active_5: 0, vip_7: 0, legend_10: 0 };
        
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: chatId });
        
        if (!user || !user.discountUsage) {
            const discountUsage = {
                active_3: 0,
                active_5: 0,
                vip_7: 0,
                legend_10: 0
            };
            
            if (user) {
                await usersCollection.updateOne(
                    { chatId: chatId },
                    { $set: { discountUsage: discountUsage } }
                );
            }
            
            return discountUsage;
        }
        
        return user.discountUsage || { active_3: 0, active_5: 0, vip_7: 0, legend_10: 0 };
        
    } catch (error) {
        console.error('❌ Error getting discount info:', error);
        return { active_3: 0, active_5: 0, vip_7: 0, legend_10: 0 };
    }
}

// Функция расчета доступных скидок
function getAvailableDiscounts(purchases, discountUsage) {
    const availableDiscounts = [];
    
    if (purchases >= 50 && discountUsage.legend_10 < 3) {
        availableDiscounts.push({
            discount: 10,
            remaining: 3 - discountUsage.legend_10,
            type: 'legend_10',
            label: '👑 Скидка Легенды 10%'
        });
    }
    
    if (purchases >= 20 && discountUsage.vip_7 < 3) {
        availableDiscounts.push({
            discount: 7,
            remaining: 3 - discountUsage.vip_7,
            type: 'vip_7',
            label: '💎 VIP скидка 7%'
        });
    }
    
    if (purchases >= 10 && discountUsage.active_5 < 2) {
        availableDiscounts.push({
            discount: 5,
            remaining: 2 - discountUsage.active_5,
            type: 'active_5',
            label: '⭐ Скидка постоянного клиента 5%'
        });
    }
    
    if (purchases >= 5 && discountUsage.active_3 < 1) {
        availableDiscounts.push({
            discount: 3,
            remaining: 1 - discountUsage.active_3,
            type: 'active_3',
            label: '🔥 Скидка активного покупателя 3%'
        });
    }
    
    return availableDiscounts;
}

// Заглушка для showPaymentMethods
async function showPaymentMethods(chatId, orderData) {
    await bot.sendMessage(chatId, '💎 Выберите способ оплаты (базовая версия)');
}

// Обновленная функция показа способов оплаты с выбором скидки
async function showPaymentMethodsWithDiscountChoice(chatId, orderData) {
    try {
        if (!db) {
            await showPaymentMethods(chatId, orderData);
            return;
        }
        
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: chatId });
        const purchases = user ? user.purchases : 0;
        const discountUsage = await getUserDiscountInfo(chatId);
        
        const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
        const selectedItem = diamondsData[orderData.index];
        const currency = orderData.region === 'RU' ? '₽' : 'KGS';
        const loyaltyInfo = getLoyaltyInfo(purchases);
        const availableDiscounts = getAvailableDiscounts(purchases, discountUsage);
        
        let orderText = `💎 *Ваш заказ*\n\n`;
        orderText += `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n`;
        orderText += `*Цена:* ${selectedItem.price} ${currency}\n`;
        orderText += `*Регион:* ${orderData.region === 'KG' ? '🇰🇬 Кыргызстан' : '🇷🇺 Россия'}\n`;
        orderText += `${loyaltyInfo.emoji} *Уровень:* ${loyaltyInfo.level}\n\n`;
        
        if (availableDiscounts.length > 0) {
            orderText += `🎟️ *Доступные скидки:*\n`;
            availableDiscounts.forEach(discount => {
                const saved = Math.round(selectedItem.price * (discount.discount / 100));
                const finalPrice = selectedItem.price - saved;
                orderText += `• ${discount.label} (-${saved} ${currency}) = *${finalPrice} ${currency}*\n`;
                orderText += `  Осталось использований: ${discount.remaining}\n\n`;
            });
        }
        
        let keyboard = [];
        
        if (availableDiscounts.length > 0) {
            orderText += `Выберите способ оплаты:`;
            
            availableDiscounts.forEach(discount => {
                const saved = Math.round(selectedItem.price * (discount.discount / 100));
                keyboard.push([{
                    text: `🎟️ Использовать скидку ${discount.discount}% (-${saved} ${currency})`,
                    callback_data: `use_discount_${discount.type}_${orderData.index}`
                }]);
            });
            
            keyboard.push([{
                text: '💰 Оплатить без скидки',
                callback_data: `no_discount_${orderData.index}`
            }]);
        } else {
            orderText += `Выберите способ оплаты:`;
            
            if (orderData.region === 'KG') {
                keyboard = [
                    [{ text: '💳 O! Деньги', callback_data: `pay_omoney_${orderData.index}` }],
                    [{ text: '💰 Balance.kg', callback_data: `pay_balance_${orderData.index}` }],
                    [{ text: '🏦 Банковский перевод', callback_data: `pay_transfer_${orderData.index}` }],
                ];
            } else {
                keyboard = [
                    [{ text: '🏦 Оплата переводом', callback_data: `pay_transfer_${orderData.index}` }],
                    [{ text: '₿ Оплата криптовалютой', callback_data: `pay_crypto_${orderData.index}` }],
                ];
            }
        }
        
        keyboard.push([{ text: '🔙 К выбору алмазов', callback_data: 'back_to_diamonds' }]);
        
        await bot.sendMessage(chatId, orderText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
        
    } catch (error) {
        console.error('❌ Error showing payment methods:', error);
        await showPaymentMethods(chatId, orderData);
    }
}

// Функция применения скидки и переход к оплате
async function applyDiscountAndProceed(chatId, messageId, discountType, orderIndex) {
    try {
        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна.');
            return;
        }
        
        const usersCollection = db.collection('users');
        const orderData = waitingForAction[chatId];
        
        if (!orderData) {
            await bot.sendMessage(chatId, '❌ Данные заказа потеряны. Начните заново.');
            return;
        }
        
        const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
        const selectedItem = diamondsData[orderIndex];
        const currency = orderData.region === 'RU' ? '₽' : 'KGS';
        
        let discount = 0;
        let updateField = '';
        
        switch(discountType) {
            case 'active_3':
                discount = 3;
                updateField = 'discountUsage.active_3';
                break;
            case 'active_5':
                discount = 5;
                updateField = 'discountUsage.active_5';
                break;
            case 'vip_7':
                discount = 7;
                updateField = 'discountUsage.vip_7';
                break;
            case 'legend_10':
                discount = 10;
                updateField = 'discountUsage.legend_10';
                break;
        }
        
        const saved = Math.round(selectedItem.price * (discount / 100));
        const finalPrice = selectedItem.price - saved;
        
        await usersCollection.updateOne(
            { chatId: chatId },
            { $inc: { [updateField]: 1 } },
            { upsert: true }
        );
        
        orderData.discountApplied = {
            type: discountType,
            percent: discount,
            saved: saved,
            originalPrice: selectedItem.price,
            finalPrice: finalPrice
        };
        
        await showFinalPaymentMethods(chatId, messageId, orderData);
        
    } catch (error) {
        console.error('❌ Error applying discount:', error);
        await bot.sendMessage(chatId, '❌ Ошибка применения скидки. Попробуйте еще раз.');
    }
}

// Финальное меню оплаты с примененной скидкой
async function showFinalPaymentMethods(chatId, messageId, orderData) {
    try {
        const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
        const selectedItem = diamondsData[orderData.index];
        const currency = orderData.region === 'RU' ? '₽' : 'KGS';
        
        let orderText = `💎 *Финальный заказ*\n\n`;
        orderText += `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n`;
        
        if (orderData.discountApplied) {
            orderText += `*Цена:* ~${orderData.discountApplied.originalPrice}~ ➜ *${orderData.discountApplied.finalPrice} ${currency}*\n`;
            orderText += `🎟️ *Скидка:* ${orderData.discountApplied.percent}% (-${orderData.discountApplied.saved} ${currency})\n\n`;
        } else {
            orderText += `*Цена:* ${selectedItem.price} ${currency}\n\n`;
        }
        
        orderText += `Выберите способ оплаты:`;
        
        let paymentButtons = [];
        
        if (orderData.region === 'KG') {
            paymentButtons = [
                [{ text: '💳 O! Деньги', callback_data: `pay_omoney_${orderData.index}` }],
                [{ text: '💰 Balance.kg', callback_data: `pay_balance_${orderData.index}` }],
                [{ text: '🏦 Банковский перевод', callback_data: `pay_transfer_${orderData.index}` }],
            ];
        } else {
            paymentButtons = [
                [{ text: '🏦 Оплата переводом', callback_data: `pay_transfer_${orderData.index}` }],
                [{ text: '₿ Оплата криптовалютой', callback_data: `pay_crypto_${orderData.index}` }],
            ];
        }
        
        paymentButtons.push([{ text: '🔙 К выбору алмазов', callback_data: 'back_to_diamonds' }]);
        
        await bot.editMessageText(orderText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: paymentButtons
            }
        });
    } catch (error) {
        console.error('❌ Error showing final payment methods:', error);
    }
}

// Обновленная функция показа истории с лимитированными скидками
async function showPurchaseHistoryWithLimitedBenefits(chatId) {
    try {
        if (!db) {
            await bot.sendMessage(chatId, '❌ База данных недоступна. Попробуйте позже.');
            return;
        }
        
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: chatId });
        const purchases = user ? user.purchases : 0;
        const lastPurchase = user ? user.lastPurchase : null;
        const discountUsage = await getUserDiscountInfo(chatId);
        
        const loyaltyInfo = getLoyaltyInfo(purchases);
        const untilBonus = loyaltyInfo.bonusFrequency - (purchases % loyaltyInfo.bonusFrequency);
        const availableDiscounts = getAvailableDiscounts(purchases, discountUsage);
        
        let historyText = `${loyaltyInfo.emoji} *${loyaltyInfo.level.toUpperCase()}*\n\n`;
        historyText += `👤 *Покупки:* ${purchases}\n`;
        
        if (purchases === 0) {
            historyText += `🎯 *Статус:* Добро пожаловать!\n\n`;
        } else {
            const bonusesReceived = Math.floor(purchases / loyaltyInfo.bonusFrequency);
            historyText += `🎁 *Бонусов получено:* ${bonusesReceived}\n`;
            
            if (untilBonus === loyaltyInfo.bonusFrequency) {
                historyText += `✨ *Следующая покупка = БОНУС!* 🎉\n`;
            } else {
                historyText += `⏳ *До бонуса:* ${untilBonus} покупок\n`;
            }
            
            if (lastPurchase) {
                historyText += `📅 *Последняя покупка:* ${lastPurchase.toLocaleDateString('ru-RU')}\n`;
            }
        }
        
        historyText += `\n🏆 *ВАШИ ПРЕИМУЩЕСТВА:*\n`;
        loyaltyInfo.benefits.forEach(benefit => {
            historyText += `${benefit}\n`;
        });
        
        if (availableDiscounts.length > 0) {
            historyText += `\n🎟️ *ДОСТУПНЫЕ СКИДКИ:*\n`;
            availableDiscounts.forEach(discount => {
                historyText += `${discount.label}: ${discount.remaining} раз\n`;
            });
        } else if (purchases >= 5) {
            historyText += `\n🎟️ *Все скидки использованы* ✨`;
        }
        
        if (loyaltyInfo.nextLevel) {
            historyText += `\n\n🎯 *До уровня "${loyaltyInfo.nextLevel.name}":* ${loyaltyInfo.nextLevel.need} покупок`;
        } else {
            historyText += `\n\n👑 *Максимальный уровень достигнут!*`;
        }
        
        let keyboard = [
            [{ text: '💎 Купить алмазы', callback_data: 'buy_diamonds' }],
            [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
        ];
        
        await bot.sendMessage(chatId, historyText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error) {
        console.error('❌ Error showing purchase history:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка при получении истории покупок.');
    }
}

// Настройка обработчиков бота
function setupBotHandlers() {
    if (!bot) return;
    
    // Обработчик команды /start
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, 'Добро пожаловать! Бот запущен и готов к работе.');
    });
    
    // Обработчик callback_query
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;
        
        try {
            if (data.startsWith('use_discount_')) {
                const parts = data.split('_');
                const discountType = parts[2] + '_' + parts[3];
                const orderIndex = parseInt(parts[4]);
                await applyDiscountAndProceed(chatId, messageId, discountType, orderIndex);
                
            } else if (data.startsWith('no_discount_')) {
                const orderIndex = parseInt(data.split('_')[2]);
                await showFinalPaymentMethods(chatId, messageId, waitingForAction[chatId]);
                
            } else if (data === 'purchase_history') {
                await showPurchaseHistoryWithLimitedBenefits(chatId);
                
            } else {
                await bot.answerCallbackQuery(query.id, 'Функция в разработке');
            }
            
        } catch (error) {
            console.error('❌ Callback query error:', error);
            await bot.answerCallbackQuery(query.id, 'Произошла ошибка');
        }
    });
}

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Bot server started successfully`);
    console.log(`🌐 Health check available at /health`);
    
    // Инициализация бота после запуска сервера
    initializeBot();
});

// Обработка ошибок для graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('👋 SIGINT received, shutting down gracefully');
    process.exit(0);
});