// scripts/backup.js
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../Data');
const BACKUP_DIR = path.join(__dirname, '../backups');
const MAX_BACKUPS = 30;

async function createBackup() {
    console.log('🔄 Creating backup...');
    
    try {
        // Create backup directory
        await fs.mkdir(BACKUP_DIR, { recursive: true });
        
        // Create timestamped backup folder
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}`);
        await fs.mkdir(backupPath, { recursive: true });
        
        // Copy all JSON files
        const files = await fs.readdir(DATA_DIR);
        let fileCount = 0;
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const source = path.join(DATA_DIR, file);
                const dest = path.join(backupPath, file);
                await fs.copyFile(source, dest);
                fileCount++;
                console.log(`  📄 Copied ${file}`);
            }
        }
        
        // Create backup metadata
        const metadata = {
            timestamp: new Date().toISOString(),
            files: fileCount,
            size: await getDirectorySize(backupPath)
        };
        await fs.writeFile(
            path.join(backupPath, 'metadata.json'),
            JSON.stringify(metadata, null, 2)
        );
        
        console.log(`✅ Backup created: ${backupPath}`);
        console.log(`📊 ${fileCount} files backed up`);
        
        // Clean old backups
        await cleanOldBackups();
        
    } catch (error) {
        console.error('❌ Backup failed:', error);
        process.exit(1);
    }
}

async function getDirectorySize(dir) {
    let size = 0;
    const files = await fs.readdir(dir, { withFileTypes: true });
    
    for (const file of files) {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
            size += await getDirectorySize(filePath);
        } else {
            const stat = await fs.stat(filePath);
            size += stat.size;
        }
    }
    
    return formatBytes(size);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function cleanOldBackups() {
    try {
        const backups = await fs.readdir(BACKUP_DIR);
        const backupDirs = backups
            .filter(name => name.startsWith('backup-'))
            .map(name => ({
                name,
                path: path.join(BACKUP_DIR, name)
            }));
        
        // Sort by name (which has timestamp)
        backupDirs.sort((a, b) => b.name.localeCompare(a.name));
        
        if (backupDirs.length > MAX_BACKUPS) {
            const toDelete = backupDirs.slice(MAX_BACKUPS);
            for (const dir of toDelete) {
                await fs.rm(dir.path, { recursive: true, force: true });
                console.log(`🗑️ Deleted old backup: ${dir.name}`);
            }
        }
    } catch (error) {
        console.warn('⚠️ Could not clean old backups:', error.message);
    }
}

// Run backup
createBackup();