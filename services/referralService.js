// Сервис реферальной системы (выгодный для владельца)
const { REFERRAL_SETTINGS, LOYALTY_LEVELS } = require('../config/constants');
const logger = require('../utils/logger');

class ReferralService {
    constructor(db) {
        this.db = db;
        this.usersCollection = db.collection('users');
        this.referralsCollection = db.collection('referrals');
    }

    // Генерация уникального реферального кода
    async generateReferralCode(userId) {
        const code = `REF${userId}${Date.now().toString(36).toUpperCase()}`;

        // Проверяем уникальность
        const existing = await this.usersCollection.findOne({ referralCode: code });
        if (existing) {
            return this.generateReferralCode(userId); // Рекурсивно генерируем новый
        }

        return code;
    }

    // Создание реферального кода для пользователя
    async createReferralCode(userId) {
        try {
            const user = await this.usersCollection.findOne({ chatId: userId });

            if (user?.referralCode) {
                return user.referralCode;
            }

            const code = await this.generateReferralCode(userId);

            await this.usersCollection.updateOne(
                { chatId: userId },
                {
                    $set: {
                        referralCode: code,
                        referralCreatedAt: new Date()
                    }
                },
                { upsert: true }
            );

            logger.info('Referral code created', { userId, code });
            return code;
        } catch (error) {
            logger.error('Error creating referral code', error);
            throw error;
        }
    }

    // Активация реферального кода (при первом заказе приглашенного)
    async activateReferral(referralCode, newUserId) {
        try {
            // Находим пользователя-реферера
            const referrer = await this.usersCollection.findOne({ referralCode });

            if (!referrer) {
                return { success: false, error: 'Неверный реферальный код' };
            }

            if (referrer.chatId === newUserId) {
                return { success: false, error: 'Нельзя использовать собственный код' };
            }

            // Проверяем, не использовал ли пользователь уже реферальный код
            const existingUser = await this.usersCollection.findOne({
                chatId: newUserId,
                referredBy: { $exists: true }
            });

            if (existingUser) {
                return { success: false, error: 'Вы уже использовали реферальный код' };
            }

            // Активируем реферальную связь
            await this.usersCollection.updateOne(
                { chatId: newUserId },
                {
                    $set: {
                        referredBy: referrer.chatId,
                        referralActivatedAt: new Date()
                    }
                },
                { upsert: true }
            );

            logger.info('Referral activated', {
                referrerId: referrer.chatId,
                referredId: newUserId,
                code: referralCode
            });

            return {
                success: true,
                referrerId: referrer.chatId,
                referrerName: referrer.username || 'Пользователь'
            };
        } catch (error) {
            logger.error('Error activating referral', error);
            return { success: false, error: 'Ошибка активации кода' };
        }
    }

    // Расчет реферального бонуса (с учетом уровня лояльности)
    calculateReferralBonus(orderAmount, referrerPurchases = 0) {
        // Базовый бонус - процент от заказа
        let bonus = Math.floor(orderAmount * REFERRAL_SETTINGS.REFERRER_BONUS_PERCENT / 100);

        // Применяем множитель уровня лояльности
        const loyaltyLevel = this.getUserLoyaltyLevel(referrerPurchases);
        const multiplier = REFERRAL_SETTINGS.REFERRER_LEVEL_MULTIPLIER[loyaltyLevel] || 1;

        bonus = Math.floor(bonus * multiplier);

        // Ограничиваем максимальным бонусом
        return Math.min(bonus, REFERRAL_SETTINGS.MAX_REFERRAL_BONUS);
    }

    // Расчет скидки для приглашенного
    calculateReferredDiscount(orderAmount) {
        const discount = Math.floor(orderAmount * REFERRAL_SETTINGS.REFERRED_DISCOUNT_PERCENT / 100);
        return Math.min(discount, orderAmount * 0.15); // Максимум 15% скидки
    }

    // Определение уровня лояльности пользователя
    getUserLoyaltyLevel(purchases) {
        const levels = Object.keys(LOYALTY_LEVELS).map(Number).sort((a, b) => b - a);

        for (const level of levels) {
            if (purchases >= level) {
                return level;
            }
        }
        return 0;
    }

    // Обработка реферального бонуса при покупке
    async processReferralBonus(buyerId, orderAmount, currency) {
        try {
            // Проверяем минимальную сумму заказа
            if (orderAmount < REFERRAL_SETTINGS.MIN_ORDER_FOR_REFERRAL) {
                return { success: false, reason: 'Сумма заказа слишком мала' };
            }

            // Находим информацию о покупателе
            const buyer = await this.usersCollection.findOne({ chatId: buyerId });

            if (!buyer?.referredBy) {
                return { success: false, reason: 'Нет реферера' };
            }

            // Находим реферера
            const referrer = await this.usersCollection.findOne({ chatId: buyer.referredBy });

            if (!referrer) {
                return { success: false, reason: 'Реферер не найден' };
            }

            // Рассчитываем бонус и скидку
            const bonus = this.calculateReferralBonus(orderAmount, referrer.purchases || 0);
            const discount = this.calculateReferredDiscount(orderAmount);

            // Начисляем бонус рефереру (в виде алмазов или кредитов)
            await this.usersCollection.updateOne(
                { chatId: buyer.referredBy },
                {
                    $inc: {
                        referralBonus: bonus,
                        totalReferralEarnings: bonus
                    }
                }
            );

            // Записываем информацию о реферальной транзакции
            await this.referralsCollection.insertOne({
                referrerId: buyer.referredBy,
                referredId: buyerId,
                orderAmount,
                currency,
                bonusAwarded: bonus,
                discountGiven: discount,
                createdAt: new Date()
            });

            // Логируем финансовую операцию
            logger.referral(buyer.referredBy, buyerId, bonus, orderAmount);

            return {
                success: true,
                bonus,
                discount,
                referrerId: buyer.referredBy
            };

        } catch (error) {
            logger.error('Error processing referral bonus', error);
            return { success: false, reason: 'Ошибка обработки' };
        }
    }

    // Получение статистики рефералов для пользователя
    async getReferralStats(userId) {
        try {
            const user = await this.usersCollection.findOne({ chatId: userId });

            if (!user) {
                return null;
            }

            // Количество приглашенных пользователей
            const referredCount = await this.usersCollection.countDocuments({ referredBy: userId });

            // Общий заработок с рефералов
            const totalEarnings = user.totalReferralEarnings || 0;

            // Текущий баланс бонусов
            const currentBonus = user.referralBonus || 0;

            // Последние рефералы
            const recentReferrals = await this.referralsCollection
                .find({ referrerId: userId })
                .sort({ createdAt: -1 })
                .limit(5)
                .toArray();

            return {
                referralCode: user.referralCode,
                referralsCount: referredCount,
                totalEarned: totalEarnings,
                currentBonus,
                recentReferrals: recentReferrals.length
            };

        } catch (error) {
            logger.error('Error getting referral stats', error);
            return null;
        }
    }
}

module.exports = ReferralService;