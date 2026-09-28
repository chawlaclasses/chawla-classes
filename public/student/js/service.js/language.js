// public/student/js/services/language.js
import { StorageService } from './storage.js';

class LanguageService {
    constructor() {
        this.languages = {
            en: {
                name: 'English',
                flag: '🇬🇧',
                code: 'en'
            },
            hi: {
                name: 'Hindi',
                flag: '🇮🇳',
                code: 'hi'
            }
        };
        
        this.currentLanguage = StorageService.get('language') || 'en';
        this.translations = {};
        this.loadTranslations(this.currentLanguage);
    }

    async loadTranslations(lang) {
        try {
            // Use centralized translation files
            const response = await fetch(`/assets/locales/${lang}.json`);
            if (response.ok) {
                this.translations = await response.json();
                this.applyTranslations();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to load translations:', error);
            return false;
        }
    }

    setLanguage(lang) {
        if (!this.languages[lang]) return;
        this.currentLanguage = lang;
        StorageService.set('language', lang);
        this.loadTranslations(lang);
        window.dispatchEvent(new CustomEvent('language-changed', {
            detail: { language: lang }
        }));
    }

    getCurrentLanguage() {
        return this.currentLanguage;
    }

    getLanguageConfig() {
        return this.languages[this.currentLanguage];
    }

    getAllLanguages() {
        return Object.values(this.languages);
    }

    translate(key, params = {}) {
        let text = this.translations[key] || key;
        
        // Replace parameters
        Object.keys(params).forEach(param => {
            text = text.replace(`{{${param}}}`, params[param]);
        });
        
        return text;
    }

    t(key, params = {}) {
        return this.translate(key, params);
    }

    applyTranslations() {
        // Apply to elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translated = this.translate(key);
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = translated;
            } else if (element.tagName === 'OPTION') {
                element.textContent = translated;
            } else {
                element.textContent = translated;
            }
        });

        // Apply HTML translations
        document.querySelectorAll('[data-i18n-html]').forEach(element => {
            const key = element.getAttribute('data-i18n-html');
            element.innerHTML = this.translate(key);
        });

        // Update language selector
        const langSelect = document.getElementById('langSelect');
        if (langSelect) {
            langSelect.value = this.currentLanguage;
        }
    }

    // Format numbers based on locale
    formatNumber(number, options = {}) {
        return new Intl.NumberFormat(this.currentLanguage, options).format(number);
    }

    // Format dates based on locale
    formatDate(date, options = {}) {
        return new Intl.DateTimeFormat(this.currentLanguage, options).format(new Date(date));
    }

    // Format currency based on locale
    formatCurrency(amount, currency = 'INR') {
        return new Intl.NumberFormat(this.currentLanguage, {
            style: 'currency',
            currency: currency
        }).format(amount);
    }

    // Get plural form
    pluralize(key, count) {
        const forms = this.translations[`${key}_plural`];
        if (!forms) return this.translate(key);
        
        if (count === 1) {
            return forms.one || this.translate(key);
        }
        return forms.other || forms.one || this.translate(key);
    }
}

export const languageService = new LanguageService();