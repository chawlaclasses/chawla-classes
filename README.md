<!-- README.md -->
# 🎓 Chawla Classes Student Portal v2.0

A premium, production-ready learning management system for coaching institutes. Built with Node.js, Express, and vanilla JavaScript.

## ✨ Features

### 🎯 Dashboard
- Real-time student statistics
- Interactive charts (Weekly, Monthly, Subject-wise)
- AI-powered recommendations
- Gamification (XP, Levels, Achievements)
- Profile completion tracker
- Quick actions (Resume Test, Practice, Notes)

### 📝 Practice Mode
- Subject/Chapter/Difficulty filters
- Bookmarked questions
- Wrong question notebook
- Unlimited attempts
- Solutions and explanations
- Performance analytics

### 📚 Tests
- Question palette with status indicators
- Timer (Question + Overall)
- Auto-save with offline support
- Fullscreen mode
- Security features (Tab switch warning, DevTools warning)
- Resume functionality
- Keyboard shortcuts

### 📊 Results
- Detailed score card
- Subject-wise analysis
- Chapter-wise analysis
- Performance trends
- PDF export
- Share results
- Previous attempt comparison

### 📖 Notes
- PDF viewer with dark mode
- Bookmarks and favorites
- Search and filter
- Download history

### 📅 Attendance
- Calendar view
- Monthly/Yearly statistics
- Late entries tracking
- Holiday calendar

### 🔔 Notifications
- Real-time updates
- Push notifications
- Read/Unread management
- Categories (Tests, Results, Homework, etc.)

### 👤 Profile
- Editable profile
- Photo upload
- Password change
- Session management
- 2FA ready

### 📱 PWA Support
- Installable app
- Offline mode
- Background sync
- Push notifications
- Caching strategy

## 🏗️ Architecture

## Messaging providers

- **SMS:** Fast2SMS only. Set `FAST2SMS_API_KEY` (see `.env.example`). It powers OTPs, notifications, Marketing Campaigns, the Communication Center and credential texts. Without a key, SMS sends are skipped and logged.
- **WhatsApp:** Meta WhatsApp Cloud API via `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` (optional).
- No other SMS provider or fallback is configured.
