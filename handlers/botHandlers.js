// Обработчики команд и сообщений бота
const logger = require('../utils/logger');
const Validators = require('../utils/validators');
const { LIMITS } = require('../config/constants');

class BotHandlers {
    constructor(bot, db, referralService, promoService, adminChatId) {
        this.bot = bot;
        this.db = db;
        this.referralService = referralService;
        this.promoService = promoService;
        this.adminChatId = adminChatId;
        this.waitingForAction = {};
    }

    // Команда истории покупок
    async handleHistory(msg) {
        const chatId = msg.chat.id;
        await this.showPurchaseHistory(chatId);
    }

    // Команда информации о бонусах
    async handleMyBonus(msg) {
        const chatId = msg.chat.id;

        try {
            const usersCollection = this.db.collection('users');
            const user = await usersCollection.findOne({ chatId: chatId });
            const purchases = user ? user.purchases : 0;
            const untilBonus = 5 - (purchases % 5);

            if (purchases === 0) {
                await this.bot.sendMessage(chatId, `У вас пока нет покупок. Совершите 5 покупок, чтобы получить бонус!`);
            } else {
                await this.bot.sendMessage(chatId, `Вы совершили ${purchases} покупок. Осталось ${untilBonus} до получения бонуса!`);
            }

            logger.userAction(chatId, 'bonus_info_viewed', { purchases, untilBonus });

        } catch (error) {
            logger.error('Database error in handleMyBonus', error);
            await this.bot.sendMessage(chatId, 'Произошла ошибка при получении данных.');
        }
    }

    // Админские команды - статистика
    async handleStats(msg) {
        const chatId = msg.chat.id;

        if (chatId !== this.adminChatId) {
            await this.bot.sendMessage(chatId, '❌ Доступ запрещен.');
            return;
        }

        try {
            const usersCollection = this.db.collection('users');
            const ordersCollection = this.db.collection('orders');

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

            // Статистика по рефералам
            const referralStats = await this.db.collection('referrals').aggregate([
                {
                    $group: {
                        _id: null,
                        totalReferrals: { $sum: 1 },
                        totalBonuses: { $sum: '$bonusAwarded' }
                    }
                }
            ]).toArray();

            // Статистика по промокодам
            const promoStats = await this.promoService.getPromoStats(this.adminChatId);

            const topUsers = await usersCollection.find()
                .sort({ purchases: -1 })
                .limit(5)
                .toArray();

            let statsText = `📊 *СТАТИСТИКА БОТА v2.0*\n\n`;
            statsText += `👥 *Всего пользователей:* ${totalUsers}\n`;
            statsText += `📦 *Всего заказов:* ${totalOrders}\n`;
            statsText += `💎 *Всего покупок:* ${totalPurchases[0]?.total || 0}\n\n`;

            statsText += `📅 *За последние 24 часа:*\n`;
            statsText += `👥 Активные пользователи: ${newUsersToday}\n`;
            statsText += `📦 Новые заказы: ${ordersToday}\n\n`;

            if (referralStats[0]) {
                statsText += `👥 *РЕФЕРАЛЫ:*\n`;
                statsText += `• Всего привлечений: ${referralStats[0].totalReferrals}\n`;
                statsText += `• Выплачено бонусов: ${referralStats[0].totalBonuses}\n\n`;
            }

            if (promoStats) {
                statsText += `🎫 *ПРОМОКОДЫ:*\n`;
                statsText += `• Активных: ${promoStats.activePromos}/${promoStats.totalPromos}\n`;
                statsText += `• Использований: ${promoStats.totalUses}\n`;
                statsText += `• Скидок дано: ${promoStats.totalDiscount}\n\n`;
            }

            statsText += `🏆 *ТОП КЛИЕНТЫ:*\n`;
            topUsers.forEach((user, index) => {
                const loyaltyEmoji = user.purchases >= 20 ? '💎' : user.purchases >= 10 ? '⭐' : '🔥';
                statsText += `${index + 1}. ${loyaltyEmoji} ${user.purchases} покупок\n`;
            });

            await this.bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });

            logger.userAction(chatId, 'admin_stats_viewed');

        } catch (error) {
            logger.error('Error getting stats', error);
            await this.bot.sendMessage(chatId, '❌ Ошибка получения статистики.');
        }
    }

    // Админская команда создания промокода
    async handleCreatePromo(msg) {
        const chatId = msg.chat.id;

        if (chatId !== this.adminChatId) {
            await this.bot.sendMessage(chatId, '❌ Доступ запрещен.');
            return;
        }

        const text = msg.text.split(' ').slice(1).join(' ');
        if (!text) {
            await this.bot.sendMessage(chatId,
                `📝 *Создание промокода*\n\n` +
                `Формат: \`/createpromo КОД СКИДКА ОПИСАНИЕ\`\n\n` +
                `Примеры:\n` +
                `\`/createpromo SALE10 10 Скидка 10%\`\n` +
                `\`/createpromo НОВЫЙ 15 Для новых клиентов\``,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const parts = text.split(' ');
        const code = parts[0];
        const discount = parseInt(parts[1]);
        const description = parts.slice(2).join(' ');

        if (!code || !discount || discount < 1 || discount > 50) {
            await this.bot.sendMessage(chatId, '❌ Неверный формат. Скидка должна быть от 1 до 50%');
            return;
        }

        try {
            const result = await this.promoService.createPromo(chatId, {
                code,
                discount,
                description,
                maxUses: 100
            });

            if (result.success) {
                await this.bot.sendMessage(chatId,
                    `✅ *Промокод создан!*\n\n` +
                    `🎫 Код: \`${result.promo.code}\`\n` +
                    `💰 Скидка: ${result.promo.discount}%\n` +
                    `📝 Описание: ${result.promo.description}\n` +
                    `🔢 Макс. использований: ${result.promo.maxUses}`,
                    { parse_mode: 'Markdown' }
                );

                logger.info('Promo created by admin', { code, discount, adminId: chatId });
            } else {
                await this.bot.sendMessage(chatId, `❌ ${result.error}`);
            }

        } catch (error) {
            logger.error('Error creating promo via command', error);
            await this.bot.sendMessage(chatId, '❌ Ошибка создания промокода');
        }
    }

    // Обработка обычных сообщений
    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const isBotCommand = msg.text && msg.text.startsWith('/');

        if (this.waitingForAction[chatId] && !isBotCommand) {
            await this.processUserInput(msg);
        }
    }

    // Обработка пользовательского ввода
    async processUserInput(msg) {
        const chatId = msg.chat.id;
        const action = this.waitingForAction[chatId];

        try {
            if (action.step === 'playerId') {
                await this.processPlayerIdInput(msg);
            } else if (action.step === 'promoCode') {
                await this.processPromoCodeInput(msg);
            } else if (['transfer_confirm', 'omoney_confirm', 'balance_confirm'].includes(action.step)) {
                await this.processPaymentConfirmation(msg);
            }
        } catch (error) {
            logger.error('Error processing user input', error);
            await this.bot.sendMessage(chatId, 'Произошла ошибка обработки. Попробуйте снова.');
        }
    }

    // Обработка ввода ID игрока
    async processPlayerIdInput(msg) {
        const chatId = msg.chat.id;
        const validation = Validators.validatePlayerId(msg.text);

        if (!validation.valid) {
            await this.bot.sendMessage(chatId, `❌ ${validation.error}\n\nПопробуйте еще раз:`);
            return;
        }

        this.waitingForAction[chatId].playerId = validation.cleanId;
        this.waitingForAction[chatId].step = 'promoCode';

        await this.bot.sendMessage(chatId,
            `✅ ID игрока: \`${validation.cleanId}\`\n\n` +
            `🎫 *Есть промокод?*\n` +
            `Введите промокод для получения скидки или нажмите "Пропустить"`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_promo' }]
                    ]
                }
            }
        );

        logger.userAction(chatId, 'player_id_entered', { playerId: validation.cleanId });
    }

    // Обработка ввода промокода
    async processPromoCodeInput(msg) {
        const chatId = msg.chat.id;
        const orderData = this.waitingForAction[chatId];

        const validation = Validators.validatePromoCode(msg.text);
        if (!validation.valid) {
            await this.bot.sendMessage(chatId, `❌ ${validation.error}\n\nПопробуйте еще раз или нажмите "Пропустить"`);
            return;
        }

        // Получаем цену товара для проверки промокода
        const diamondsData = orderData.region === 'RU' ? require('../config/constants').DIAMONDS_DATA_RU : require('../config/constants').DIAMONDS_DATA_KG;
        const selectedItem = diamondsData[orderData.index];

        const promoResult = await this.promoService.applyPromo(chatId, validation.cleanCode, selectedItem.price);

        if (promoResult.success) {
            this.waitingForAction[chatId].promoCode = validation.cleanCode;
            this.waitingForAction[chatId].discount = promoResult.discount;
            this.waitingForAction[chatId].finalPrice = promoResult.newAmount;

            await this.bot.sendMessage(chatId,
                `🎉 *Промокод применен!*\n\n` +
                `🎫 Код: \`${validation.cleanCode}\`\n` +
                `💰 Скидка: ${promoResult.discount}\n` +
                `💳 К оплате: ${promoResult.newAmount}`,
                { parse_mode: 'Markdown' }
            );

            logger.userAction(chatId, 'promo_applied', {
                promoCode: validation.cleanCode,
                discount: promoResult.discount
            });
        } else {
            await this.bot.sendMessage(chatId, `❌ ${promoResult.error}\n\nПродолжить без промокода?`, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Продолжить', callback_data: 'skip_promo' },
                            { text: '🔄 Другой код', callback_data: 'retry_promo' }
                        ]
                    ]
                }
            });
            return;
        }

        // Переходим к выбору способа оплаты
        this.waitingForAction[chatId].step = 'paymentChoice';
        await this.showPaymentMethods(chatId, this.waitingForAction[chatId]);
    }

    // Обработка подтверждения платежа (скриншоты)
    async processPaymentConfirmation(msg) {
        const chatId = msg.chat.id;
        const orderData = this.waitingForAction[chatId];

        if (!msg.photo) {
            await this.bot.sendMessage(chatId,
                '📷 Пожалуйста, отправьте именно *скриншот* (изображение), а не другой тип файла.\n\nНам нужно увидеть подтверждение оплаты! 🧾',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Определяем тип платежа
        let paymentType = 'Банковский перевод';
        if (orderData.step === 'omoney_confirm') {
            paymentType = 'O! Деньги';
        } else if (orderData.step === 'balance_confirm') {
            paymentType = 'Balance.kg';
        }

        await this.sendPaymentToAdmin(msg, orderData, paymentType);

        let confirmMessage = '✅ *Ваш скриншот отправлен на проверку.*\n\n';
        if (paymentType === 'O! Деньги') {
            confirmMessage += '📱 Проверяем платеж через O! Деньги...';
        } else if (paymentType === 'Balance.kg') {
            confirmMessage += '💰 Проверяем платеж через Balance.kg...';
        } else {
            confirmMessage += '🏦 Проверяем банковский перевод...';
        }
        confirmMessage += '\n\nМы сообщим вам, как только оплата будет подтверждена! ⏱️';

        await this.bot.sendMessage(chatId, confirmMessage, { parse_mode: 'Markdown' });

        delete this.waitingForAction[chatId];
        logger.userAction(chatId, 'payment_screenshot_sent', { paymentType });
    }

    // Отправка информации о платеже админу
    async sendPaymentToAdmin(msg, orderData, paymentType) {
        const diamondsData = orderData.region === 'RU' ? require('../config/constants').DIAMONDS_DATA_RU : require('../config/constants').DIAMONDS_DATA_KG;
        const selectedItem = diamondsData[orderData.index];
        const currency = orderData.region === 'RU' ? '₽' : 'KGS';
        const finalPrice = orderData.finalPrice || selectedItem.price;

        const userUsername = msg.from.username;
        const userFirstName = msg.from.first_name;

        let adminMessage =
            `📢 *НОВЫЙ ЗАКАЗ (${paymentType})*\n\n` +
            `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
            `*Сумма:* ${finalPrice} ${currency}\n` +
            `*Способ оплаты:* ${paymentType}\n` +
            `*Пользователь:* ${userUsername ? `@${userUsername}` : userFirstName}\n` +
            `*ID пользователя:* ${msg.from.id}\n` +
            `*ID игрока MLBB:* ${orderData.playerId}\n` +
            `*Регион:* ${orderData.region}`;

        if (orderData.promoCode) {
            adminMessage += `\n*Промокод:* ${orderData.promoCode} (-${orderData.discount})`;
        }

        adminMessage += `\n*Ожидает подтверждения: скриншот был отправлен.*`;

        await this.bot.sendPhoto(this.adminChatId, msg.photo[msg.photo.length - 1].file_id, {
            caption: adminMessage,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Подтвердить', callback_data: `confirm_payment_${msg.from.id}` }],
                    [{ text: '❌ Отклонить', callback_data: `decline_payment_${msg.from.id}` }]
                ]
            }
        });
    }

    // Показать способы оплаты
    async showPaymentMethods(chatId, orderData) {
        const diamondsData = orderData.region === 'RU' ? require('../config/constants').DIAMONDS_DATA_RU : require('../config/constants').DIAMONDS_DATA_KG;
        const selectedItem = diamondsData[orderData.index];
        const currency = orderData.region === 'RU' ? '₽' : 'KGS';
        const finalPrice = orderData.finalPrice || selectedItem.price;

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

        let orderText = `💎 *Ваш заказ*\n\n` +
            `*Товар:* ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
            `*Регион:* ${orderData.region === 'KG' ? '🇰🇬 Кыргызстан' : '🇷🇺 Россия'}\n`;

        if (orderData.promoCode) {
            orderText += `*Промокод:* ${orderData.promoCode}\n` +
                `*Скидка:* -${orderData.discount} ${currency}\n` +
                `*~~Цена:~~ ${selectedItem.price} ${currency}*\n` +
                `*К оплате:* ${finalPrice} ${currency}\n\n`;
        } else {
            orderText += `*Стоимость:* ${selectedItem.price} ${currency}\n\n`;
        }

        orderText += `Выберите способ оплаты:`;

        await this.bot.sendMessage(chatId, orderText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: paymentButtons
            }
        });
    }

    // Показать историю покупок с улучшениями
    async showPurchaseHistory(chatId) {
        try {
            const usersCollection = this.db.collection('users');
            const user = await usersCollection.findOne({ chatId: chatId });
            const purchases = user ? user.purchases : 0;
            const totalSpent = user ? user.totalSpent : 0;
            const lastPurchase = user ? user.lastPurchase : null;
            const untilBonus = 5 - (purchases % 5);

            // Получаем реферальную статистику
            const referralStats = await this.referralService.getReferralStats(chatId);

            let historyText = `📊 *История покупок*\n\n`;
            historyText += `👤 *Ваши покупки:* ${purchases}\n`;
            historyText += `💰 *Потрачено:* ${totalSpent.toFixed(2)}\n`;

            if (referralStats) {
                historyText += `💎 *Реферальные бонусы:* ${referralStats.currentBonus}\n`;
            }

            // ... остальная логика истории покупок

            await this.bot.sendMessage(chatId, historyText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💎 Купить алмазы', callback_data: 'buy_diamonds' }],
                        [{ text: '👥 Рефералы', callback_data: 'referral_menu' }],
                        [{ text: '🔙 Главное меню', callback_data: 'back_to_start' }]
                    ]
                }
            });

            logger.userAction(chatId, 'purchase_history_viewed');

        } catch (error) {
            logger.error('Error showing purchase history', error);
            await this.bot.sendMessage(chatId, '❌ Произошла ошибка при получении истории покупок.');
        }
    }
}

module.exports = BotHandlers;