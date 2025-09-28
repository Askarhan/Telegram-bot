// Система логирования
const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../logs');
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data
        };
        return JSON.stringify(logEntry) + '\n';
    }

    writeLog(filename, content) {
        const filePath = path.join(this.logDir, filename);
        fs.appendFileSync(filePath, content);
    }

    info(message, data = null) {
        const logMessage = this.formatMessage('INFO', message, data);
        console.log(`ℹ️ ${message}`, data || '');
        this.writeLog('info.log', logMessage);
    }

    error(message, error = null) {
        const logMessage = this.formatMessage('ERROR', message, error);
        console.error(`❌ ${message}`, error || '');
        this.writeLog('error.log', logMessage);
    }

    warn(message, data = null) {
        const logMessage = this.formatMessage('WARN', message, data);
        console.warn(`⚠️ ${message}`, data || '');
        this.writeLog('warn.log', logMessage);
    }

    success(message, data = null) {
        const logMessage = this.formatMessage('SUCCESS', message, data);
        console.log(`✅ ${message}`, data || '');
        this.writeLog('success.log', logMessage);
    }

    // Логирование финансовых операций (важно для бизнеса)
    financial(type, amount, currency, userId, details = {}) {
        const financeData = {
            type, // 'order', 'referral_bonus', 'promo_discount', etc.
            amount,
            currency,
            userId,
            details,
            timestamp: new Date().toISOString()
        };

        this.writeLog('finance.log', this.formatMessage('FINANCE', `${type}: ${amount} ${currency}`, financeData));
        console.log(`💰 FINANCE: ${type} - ${amount} ${currency} (User: ${userId})`);
    }

    // Логирование действий пользователей
    userAction(userId, action, details = {}) {
        const actionData = {
            userId,
            action,
            details,
            timestamp: new Date().toISOString()
        };

        this.writeLog('user_actions.log', this.formatMessage('USER_ACTION', action, actionData));
    }

    // Логирование реферальной активности
    referral(referrerId, referredId, bonus, orderAmount) {
        const referralData = {
            referrerId,
            referredId,
            bonus,
            orderAmount,
            timestamp: new Date().toISOString()
        };

        this.writeLog('referrals.log', this.formatMessage('REFERRAL', 'Referral bonus awarded', referralData));
        this.financial('referral_bonus', bonus, 'points', referrerId, { referredId, orderAmount });
    }
}

module.exports = new Logger();