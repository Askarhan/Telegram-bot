// Импортируем необходимые модули
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');

// Создаем Express приложение
const app = express();

// Создаем экземпляр бота
const bot = new TelegramBot(process.env.TOKEN, { polling: true });

// Переменные для базы данных
let db;

console.log('🔍 Checking environment variables:');
console.log('TOKEN exists:', !!process.env.TOKEN);
console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('CRYPTOCLOUD_API_KEY exists:', !!process.env.CRYPTOCLOUD_API_KEY);
console.log('WEBHOOK_URL:', process.env.WEBHOOK_URL);

// Теперь можно использовать app
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.removeHeader('X-Powered-By');
    next();
});

// Остальной ваш 

// Система уровней лояльности с разумными бонусами
function getLoyaltyInfo(purchases) {
    let level, emoji, benefits, nextLevel, discount, bonusFrequency;
    
    if (purchases >= 50) {
        level = 'Легенда';
        emoji = '👑';
        discount = 0; // Легенды получают другие бонусы вместо постоянной скидки
        bonusFrequency = 4; // бонус каждые 4 покупки (как у обычных)
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
        discount = 0; // VIP получают лимитированные скидки
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
        discount = 0; // Постоянные клиенты - лимитированные скидки
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
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: chatId });
        const purchases = user ? user.purchases : 0;
        
        // Инициализируем данные о скидках если их нет
        if (!user || !user.discountUsage) {
            const discountUsage = {
                active_3: 0,    // скидка 3% использована раз
                active_5: 0,    // скидка 5% использована раз  
                vip_7: 0,       // скидка 7% использована раз
                legend_10: 0    // скидка 10% использована раз
            };
            
            if (user) {
                await usersCollection.updateOne(
                    { chatId: chatId },
                    { $set: { discountUsage: discountUsage } }
                );
            }
            
            return discountUsage;
        }
        
        return user.discountUsage || {
            active_3: 0, active_5: 0, vip_7: 0, legend_10: 0
        };
        
    } catch (error) {
        console.error('❌ Error getting discount info:', error);
        return { active_3: 0, active_5: 0, vip_7: 0, legend_10: 0 };
    }
}

// Функция расчета доступных скидок
function getAvailableDiscounts(purchases, discountUsage) {
    const availableDiscounts = [];
    
    if (purchases >= 50) {
        // Легенда: 3 использования скидки 10%
        if (discountUsage.legend_10 < 3) {
            availableDiscounts.push({
                discount: 10,
                remaining: 3 - discountUsage.legend_10,
                type: 'legend_10',
                label: '👑 Скидка Легенды 10%'
            });
        }
    }
    
    if (purchases >= 20) {
        // VIP: 3 использования скидки 7%
        if (discountUsage.vip_7 < 3) {
            availableDiscounts.push({
                discount: 7,
                remaining: 3 - discountUsage.vip_7,
                type: 'vip_7',
                label: '💎 VIP скидка 7%'
            });
        }
    }
    
    if (purchases >= 10) {
        // Постоянный клиент: 2 использования скидки 5%
        if (discountUsage.active_5 < 2) {
            availableDiscounts.push({
                discount: 5,
                remaining: 2 - discountUsage.active_5,
                type: 'active_5',
                label: '⭐ Скидка постоянного клиента 5%'
            });
        }
    }
    
    if (purchases >= 5) {
        // Активный покупатель: 1 использование скидки 3%
        if (discountUsage.active_3 < 1) {
            availableDiscounts.push({
                discount: 3,
                remaining: 1 - discountUsage.active_3,
                type: 'active_3',
                label: '🔥 Скидка активного покупателя 3%'
            });
        }
    }
    
    return availableDiscounts;
}

// Обновленная функция показа способов оплаты с выбором скидки
async function showPaymentMethodsWithDiscountChoice(chatId, orderData) {
    try {
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
        
        // Показываем доступные скидки
        if (availableDiscounts.length > 0) {
            orderText += `🎟️ *Доступные скидки:*\n`;
            availableDiscounts.forEach(discount => {
                const saved = Math.round(selectedItem.price * (discount.discount / 100));
                const finalPrice = selectedItem.price - saved;
                orderText += `• ${discount.label} (-${saved} ${currency}) = *${finalPrice} ${currency}*\n`;
                orderText += `  Осталось использований: ${discount.remaining}\n\n`;
            });
        }
        
        // Кнопки для выбора скидки или без скидки
        let keyboard = [];
        
        // Кнопки со скидками (только если есть доступные)
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
            
            // Обычные кнопки оплаты
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
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ chatId: chatId });
        const purchases = user ? user.purchases : 0;
        const orderData = waitingForAction[chatId];
        
        if (!orderData) {
            await bot.sendMessage(chatId, '❌ Данные заказа потеряны. Начните заново.');
            return;
        }
        
        const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
        const selectedItem = diamondsData[orderIndex];
        const currency = orderData.region === 'RU' ? '₽' : 'KGS';
        
        // Определяем скидку
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
        
        // Увеличиваем счетчик использования скидки
        await usersCollection.updateOne(
            { chatId: chatId },
            { $inc: { [updateField]: 1 } },
            { upsert: true }
        );
        
        // Сохраняем информацию о скидке в заказе
        orderData.discountApplied = {
            type: discountType,
            percent: discount,
            saved: saved,
            originalPrice: selectedItem.price,
            finalPrice: finalPrice
        };
        
        // Показываем подтверждение и переходим к способам оплаты
        await showFinalPaymentMethods(chatId, messageId, orderData);
        
    } catch (error) {
        console.error('❌ Error applying discount:', error);
        await bot.sendMessage(chatId, '❌ Ошибка применения скидки. Попробуйте еще раз.');
    }
}

// Финальное меню оплаты с примененной скидкой
async function showFinalPaymentMethods(chatId, messageId, orderData) {
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
        
        // Показываем преимущества уровня
        historyText += `\n🏆 *ВАШИ ПРЕИМУЩЕСТВА:*\n`;
        loyaltyInfo.benefits.forEach(benefit => {
            historyText += `${benefit}\n`;
        });
        
        // Показываем доступные скидки
        if (availableDiscounts.length > 0) {
            historyText += `\n🎟️ *ДОСТУПНЫЕ СКИДКИ:*\n`;
            availableDiscounts.forEach(discount => {
                historyText += `${discount.label}: ${discount.remaining} раз\n`;
            });
        } else if (purchases >= 5) {
            historyText += `\n🎟️ *Все скидки использованы* ✨`;
        }
        
        // Прогресс до следующего уровня
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

// Добавьте эти обработчики в основной callback handler:
/*
} else if (q.data.startsWith('use_discount_')) {
    const parts = q.data.split('_');
    const discountType = parts[2] + '_' + parts[3]; // например "legend_10"
    const orderIndex = parts[4];
    await applyDiscountAndProceed(chatId, messageId, discountType, orderIndex);
    
} else if (q.data.startsWith('no_discount_')) {
    const orderIndex = q.data.split('_')[2];
    await showFinalPaymentMethods(chatId, messageId, waitingForAction[chatId]);
*/