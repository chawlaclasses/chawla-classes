// public/student/js/services/theme.js
import { StorageService } from './storage.js';

class ThemeService {
    constructor() {
        this.themes = {
            dark: {
                name: 'Dark',
                icon: 'fa-moon',
                className: ''
            },
            light: {
                name: 'Light',
                icon: 'fa-sun',
                className: 'light-theme'
            }
        };
        
        this.currentTheme = StorageService.get('theme') || 'dark';
        this.applyTheme(this.currentTheme);
        this.watchSystemTheme();
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
        return newTheme;
    }

    setTheme(theme) {
        if (!this.themes[theme]) return;
        this.currentTheme = theme;
        this.applyTheme(theme);
        StorageService.set('theme', theme);
        window.dispatchEvent(new CustomEvent('theme-changed', {
            detail: { theme }
        }));
    }

    applyTheme(theme) {
        const config = this.themes[theme];
        document.documentElement.setAttribute('data-theme', theme === 'dark' ? '' : 'light');
        document.documentElement.style.setProperty('--theme-transition', 'all 0.3s ease');
        
        // Update meta theme color
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            const color = theme === 'dark' ? '#0a1628' : '#f8fafc';
            metaThemeColor.content = color;
        }

        // Update UI elements
        const icon = document.getElementById('themeIcon');
        const label = document.getElementById('themeLabel');
        if (icon) icon.className = `fas ${config.icon}`;
        if (label) label.textContent = config.name;
    }

    watchSystemTheme() {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (e) => {
            if (!StorageService.get('theme')) {
                const theme = e.matches ? 'dark' : 'light';
                this.setTheme(theme);
            }
        });
    }

    getCurrentTheme() {
        return this.currentTheme;
    }

    getThemeConfig() {
        return this.themes[this.currentTheme];
    }

    getAllThemes() {
        return Object.entries(this.themes).map(([key, value]) => ({
            id: key,
            ...value
        }));
    }

    // Check if dark mode is active
    isDarkMode() {
        return this.currentTheme === 'dark';
    }

    // Get CSS variables for current theme
    getThemeVariables() {
        const root = document.documentElement;
        const styles = getComputedStyle(root);
        return {
            navy: styles.getPropertyValue('--navy'),
            gold: styles.getPropertyValue('--gold'),
            white: styles.getPropertyValue('--white'),
            gray100: styles.getPropertyValue('--gray-100'),
            gray400: styles.getPropertyValue('--gray-400')
        };
    }
}

export const themeService = new ThemeService();