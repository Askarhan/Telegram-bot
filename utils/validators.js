// Валидаторы для безопасности данных
const { LIMITS } = require('../config/constants');

class Validators {
    // Валидация ID игрока MLBB
    static validatePlayerId(playerId) {
        if (!playerId || typeof playerId !== 'string') {
            return { valid: false, error: 'ID игрока должен быть строкой' };
        }

        const cleanId = playerId.trim();

        if (cleanId.length < LIMITS.MIN_PLAYER_ID_LENGTH || cleanId.length > LIMITS.MAX_PLAYER_ID_LENGTH) {
            return {
                valid: false,
                error: `ID игрока должен быть от ${LIMITS.MIN_PLAYER_ID_LENGTH} до ${LIMITS.MAX_PLAYER_ID_LENGTH} символов`
            };
        }

        // MLBB ID обычно содержит только цифры
        if (!/^\d+$/.test(cleanId)) {
            return { valid: false, error: 'ID игрока должен содержать только цифры' };
        }

        return { valid: true, cleanId };
    }

    // Валидация промокода
    static validatePromoCode(code) {
        if (!code || typeof code !== 'string') {
            return { valid: false, error: 'Промокод должен быть строкой' };
        }

        const cleanCode = code.trim().toUpperCase();

        if (cleanCode.length < 3 || cleanCode.length > 20) {
            return { valid: false, error: 'Промокод должен быть от 3 до 20 символов' };
        }

        // Только буквы, цифры и дефисы
        if (!/^[A-Z0-9-]+$/.test(cleanCode)) {
            return { valid: false, error: 'Промокод может содержать только буквы, цифры и дефисы' };
        }

        return { valid: true, cleanCode };
    }

    // Валидация суммы платежа
    static validatePaymentAmount(amount, minAmount = 50) {
        if (!amount || typeof amount !== 'number') {
            return { valid: false, error: 'Сумма должна быть числом' };
        }

        if (amount < minAmount) {
            return { valid: false, error: `Минимальная сумма заказа: ${minAmount}` };
        }

        if (amount > 50000) {
            return { valid: false, error: 'Максимальная сумма заказа: 50000' };
        }

        return { valid: true };
    }

    // Валидация региона
    static validateRegion(region) {
        const validRegions = ['RU', 'KG'];

        if (!validRegions.includes(region)) {
            return { valid: false, error: 'Неверный регион' };
        }

        return { valid: true };
    }

    // Проверка на спам (лимит заказов в день)
    static checkOrderLimit(userOrders, maxOrders = LIMITS.MAX_ORDERS_PER_DAY) {
        const today = new Date().toDateString();
        const todayOrders = userOrders.filter(order =>
            new Date(order.createdAt).toDateString() === today
        ).length;

        if (todayOrders >= maxOrders) {
            return {
                valid: false,
                error: `Превышен лимит заказов в день (${maxOrders}). Попробуйте завтра.`
            };
        }

        return { valid: true, remaining: maxOrders - todayOrders };
    }

    // Безопасная обработка пользовательского ввода
    static sanitizeInput(input) {
        if (typeof input !== 'string') return input;

        return input
            .trim()
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Удаление скриптов
            .replace(/[<>]/g, '') // Удаление HTML тегов
            .slice(0, 1000); // Ограничение длины
    }
}

module.exports = Validators;