// Сервис промокодов (с контролем владельца)
const { PROMO_SETTINGS } = require('../config/constants');
const logger = require('../utils/logger');
const Validators = require('../utils/validators');

class PromoService {
    constructor(db) {
        this.db = db;
        this.promosCollection = db.collection('promos');
        this.usersCollection = db.collection('users');
        this.promoUsageCollection = db.collection('promo_usage');
    }

    // Создание промокода (только админ)
    async createPromo(adminId, promoData) {
        try {
            const validation = Validators.validatePromoCode(promoData.code);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }

            // Проверяем уникальность кода
            const existing = await this.promosCollection.findOne({ code: validation.cleanCode });
            if (existing) {
                return { success: false, error: 'Промокод уже существует' };
            }

            const promo = {
                code: validation.cleanCode,
                discount: Math.min(promoData.discount || PROMO_SETTINGS.DEFAULT_DISCOUNT, PROMO_SETTINGS.MAX_DISCOUNT),
                type: promoData.type || 'percentage', // percentage, fixed, first_order
                maxUses: promoData.maxUses || 100,
                currentUses: 0,
                minOrderAmount: promoData.minOrderAmount || 100,
                validUntil: promoData.validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 дней
                createdBy: adminId,
                createdAt: new Date(),
                active: true,
                description: promoData.description || ''
            };

            await this.promosCollection.insertOne(promo);

            logger.info('Promo code created', {
                adminId,
                code: promo.code,
                discount: promo.discount,
                maxUses: promo.maxUses
            });

            return { success: true, promo };

        } catch (error) {
            logger.error('Error creating promo', error);
            return { success: false, error: 'Ошибка создания промокода' };
        }
    }

    // Применение промокода
    async applyPromo(userId, promoCode, orderAmount) {
        try {
            const validation = Validators.validatePromoCode(promoCode);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }

            // Находим промокод
            const promo = await this.promosCollection.findOne({
                code: validation.cleanCode,
                active: true
            });

            if (!promo) {
                return { success: false, error: 'Промокод не найден или неактивен' };
            }

            // Проверяем срок действия
            if (new Date() > promo.validUntil) {
                return { success: false, error: 'Промокод истек' };
            }

            // Проверяем лимит использований
            if (promo.currentUses >= promo.maxUses) {
                return { success: false, error: 'Промокод исчерпан' };
            }

            // Проверяем минимальную сумму заказа
            if (orderAmount < promo.minOrderAmount) {
                return {
                    success: false,
                    error: `Минимальная сумма заказа для промокода: ${promo.minOrderAmount}`
                };
            }

            // Проверяем, не использовал ли пользователь этот промокод
            const userUsage = await this.promoUsageCollection.findOne({
                userId,
                promoCode: promo.code
            });

            if (userUsage) {
                return { success: false, error: 'Вы уже использовали этот промокод' };
            }

            // Специальная логика для промокодов первого заказа
            if (promo.type === 'first_order') {
                const user = await this.usersCollection.findOne({ chatId: userId });
                if (user && user.purchases > 0) {
                    return { success: false, error: 'Этот промокод только для первого заказа' };
                }
            }

            // Рассчитываем скидку
            let discount = 0;

            if (promo.type === 'percentage') {
                discount = Math.floor(orderAmount * promo.discount / 100);
            } else if (promo.type === 'fixed') {
                discount = Math.min(promo.discount, orderAmount - 50); // Минимум 50 остается
            }

            // Ограничиваем максимальную скидку
            const maxDiscount = Math.floor(orderAmount * PROMO_SETTINGS.MAX_DISCOUNT / 100);
            discount = Math.min(discount, maxDiscount);

            return {
                success: true,
                discount,
                newAmount: orderAmount - discount,
                promoCode: promo.code,
                promoId: promo._id
            };

        } catch (error) {
            logger.error('Error applying promo', error);
            return { success: false, error: 'Ошибка применения промокода' };
        }
    }

    // Подтверждение использования промокода (после успешной оплаты)
    async confirmPromoUsage(userId, promoCode, discount, orderAmount) {
        try {
            // Увеличиваем счетчик использований
            await this.promosCollection.updateOne(
                { code: promoCode },
                { $inc: { currentUses: 1 } }
            );

            // Записываем использование
            await this.promoUsageCollection.insertOne({
                userId,
                promoCode,
                discount,
                orderAmount,
                usedAt: new Date()
            });

            // Логируем финансовую операцию
            logger.financial('promo_discount', discount, 'discount', userId, {
                promoCode,
                orderAmount
            });

            logger.info('Promo usage confirmed', {
                userId,
                promoCode,
                discount,
                orderAmount
            });

        } catch (error) {
            logger.error('Error confirming promo usage', error);
        }
    }

    // Получение всех промокодов (админ)
    async getAllPromos(adminId) {
        try {
            const promos = await this.promosCollection
                .find({})
                .sort({ createdAt: -1 })
                .toArray();

            return promos.map(promo => ({
                code: promo.code,
                discount: promo.discount,
                type: promo.type,
                maxUses: promo.maxUses,
                currentUses: promo.currentUses,
                active: promo.active,
                validUntil: promo.validUntil,
                description: promo.description
            }));

        } catch (error) {
            logger.error('Error getting promos', error);
            return [];
        }
    }

    // Деактивация промокода
    async deactivatePromo(adminId, promoCode) {
        try {
            const result = await this.promosCollection.updateOne(
                { code: promoCode.toUpperCase() },
                { $set: { active: false, deactivatedAt: new Date(), deactivatedBy: adminId } }
            );

            if (result.matchedCount === 0) {
                return { success: false, error: 'Промокод не найден' };
            }

            logger.info('Promo deactivated', { adminId, promoCode });
            return { success: true };

        } catch (error) {
            logger.error('Error deactivating promo', error);
            return { success: false, error: 'Ошибка деактивации промокода' };
        }
    }

    // Статистика по промокодам
    async getPromoStats(adminId) {
        try {
            const totalPromos = await this.promosCollection.countDocuments({});
            const activePromos = await this.promosCollection.countDocuments({ active: true });

            // Общая сумма скидок
            const usageStats = await this.promoUsageCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalDiscount: { $sum: '$discount' },
                        totalUses: { $sum: 1 }
                    }
                }
            ]).toArray();

            const stats = usageStats[0] || { totalDiscount: 0, totalUses: 0 };

            // Топ промокодов
            const topPromos = await this.promoUsageCollection.aggregate([
                {
                    $group: {
                        _id: '$promoCode',
                        uses: { $sum: 1 },
                        totalDiscount: { $sum: '$discount' }
                    }
                },
                { $sort: { uses: -1 } },
                { $limit: 5 }
            ]).toArray();

            return {
                totalPromos,
                activePromos,
                totalDiscount: stats.totalDiscount,
                totalUses: stats.totalUses,
                topPromos
            };

        } catch (error) {
            logger.error('Error getting promo stats', error);
            return null;
        }
    }

    // Автоматические промокоды для новых пользователей
    async createWelcomePromo(userId) {
        const welcomeCode = `WELCOME${userId}${Date.now().toString(36).toUpperCase()}`;

        try {
            await this.promosCollection.insertOne({
                code: welcomeCode,
                discount: PROMO_SETTINGS.FIRST_ORDER_DISCOUNT,
                type: 'first_order',
                maxUses: 1,
                currentUses: 0,
                minOrderAmount: 100,
                validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 дней
                createdBy: 'system',
                createdAt: new Date(),
                active: true,
                description: 'Приветственная скидка для нового пользователя',
                personalFor: userId
            });

            return welcomeCode;

        } catch (error) {
            logger.error('Error creating welcome promo', error);
            return null;
        }
    }
}

module.exports = PromoService;