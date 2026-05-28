const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Chrome cookie database path
const getChromeCookiePath = (profilePath) => {
    return path.join(profilePath, 'Network', 'Cookies');
};

const getChromeCookiesKeyPath = (profilePath) => {
    return path.join(profilePath, '..', 'Local State');
};

// Decrypt Chrome cookies (Windows)
const getChromeKey = (localStatePath) => {
    try {
        const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
        const encryptedKey = Buffer.from(localState.os_crypt.encrypted_key, 'base64');
        // Remove DPAPI prefix
        const keyWithPrefix = encryptedKey.slice(5);
        // Use DPAPI via PowerShell
        return keyWithPrefix;
    } catch (e) {
        console.error('Error getting Chrome key:', e.message);
        return null;
    }
};

// Decrypt using DPAPI via PowerShell
const decryptWithDPAPI = (encryptedData) => {
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        const b64 = encryptedData.toString('base64');
        const ps = `
            Add-Type -AssemblyName System.Security
            $encrypted = [Convert]::FromBase64String('${b64}')
            $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
            [Convert]::ToBase64String($decrypted)
        `;
        exec(`powershell -Command "${ps.replace(/\n/g, ' ')}"`, (err, stdout) => {
            if (err) reject(err);
            else resolve(Buffer.from(stdout.trim(), 'base64'));
        });
    });
};

// Get list of Chrome profiles
const getChromeProfiles = () => {
    const basePath = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
    const profiles = [];

    try {
        const items = fs.readdirSync(basePath);
        items.forEach(item => {
            const itemPath = path.join(basePath, item);
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory() && item.startsWith('Profile')) {
                profiles.push({
                    name: item,
                    path: itemPath
                });
            }
        });
    } catch (e) {
        console.error('Error reading profiles:', e.message);
    }

    return profiles;
};

// Parse cookies from SQLite database using sql.js
const parseCookiesFromDb = async (dbPath) => {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();

    try {
        const dbBuffer = fs.readFileSync(dbPath);
        const db = new SQL.Database(dbBuffer);

        const results = db.exec(`
            SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly, creation_utc
            FROM cookies
        `);

        db.close();

        if (results.length === 0) return [];

        const columns = results[0].columns;
        const cookies = results[0].values.map(row => {
            const cookie = {};
            columns.forEach((col, i) => {
                cookie[col] = row[i];
            });
            return cookie;
        });

        return cookies;
    } catch (e) {
        console.error('Error parsing cookies:', e.message);
        return [];
    }
};

// Decrypt cookie value
const decryptCookieValue = async (encryptedValue) => {
    if (!encryptedValue || encryptedValue.length === 0) return '';

    try {
        const b64 = Buffer.from(encryptedValue).toString('base64');
        const ps = `
            Add-Type -AssemblyName System.Security
            $encrypted = [Convert]::FromBase64String('${b64}')
            $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
            [System.Text.Encoding]::UTF8.GetString($decrypted)
        `;

        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            exec(`powershell -Command "${ps.replace(/\n/g, ' ')}"`, (err, stdout) => {
                if (err) reject(err);
                else resolve(stdout.trim());
            });
        });
    } catch (e) {
        return encryptedValue.toString();
    }
};

// Main backup function
const backupCookies = async () => {
    const profiles = getChromeProfiles();
    const backupDir = path.join(__dirname, 'cookie-backups');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    console.log(`Found ${profiles.length} Chrome profiles\n`);

    for (const profile of profiles) {
        console.log(`Processing: ${profile.name}`);

        const cookiePath = getChromeCookiePath(profile.path);

        if (!fs.existsSync(cookiePath)) {
            console.log(`  - No cookies file found, skipping...\n`);
            continue;
        }

        try {
            // Copy cookies database to temp location (Chrome locks the file)
            const tempPath = path.join(backupDir, `temp_${profile.name}_cookies`);
            fs.copyFileSync(cookiePath, tempPath);

            // Parse cookies
            const cookies = await parseCookiesFromDb(tempPath);

            // Decrypt cookie values
            const decryptedCookies = [];
            for (const cookie of cookies) {
                if (cookie.value && cookie.value.length > 0) {
                    try {
                        cookie.value = await decryptCookieValue(cookie.value);
                    } catch (e) {
                        // Keep original if decryption fails
                    }
                }
                decryptedCookies.push(cookie);
            }

            // Save backup
            const backupFile = path.join(backupDir, `${profile.name}_${timestamp}.json`);
            fs.writeFileSync(backupFile, JSON.stringify(decryptedCookies, null, 2));

            // Clean up temp file
            fs.unlinkSync(tempPath);

            console.log(`  - Backed up ${decryptedCookies.length} cookies`);
            console.log(`  - Saved to: ${backupFile}\n`);

        } catch (e) {
            console.error(`  - Error: ${e.message}\n`);
        }
    }

    console.log('Backup complete!');
    console.log(`All backups saved to: ${backupDir}`);
};

// Restore function
const restoreCookies = async (profileName, backupFile) => {
    if (!fs.existsSync(backupFile)) {
        console.error('Backup file not found:', backupFile);
        return;
    }

    const profiles = getChromeProfiles();
    const profile = profiles.find(p => p.name === profileName);

    if (!profile) {
        console.error('Profile not found:', profileName);
        return;
    }

    console.log(`Restoring cookies to: ${profile.name}`);

    const cookiePath = getChromeCookiePath(profile.path);
    const cookies = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

    try {
        const tempPath = path.join(backupDir || __dirname, 'temp_restore_cookies');

        // Copy original database
        fs.copyFileSync(cookiePath, tempPath);

        const initSqlJs = require('sql.js');
        const SQL = await initSqlJs();
        const dbBuffer = fs.readFileSync(tempPath);
        const db = new SQL.Database(dbBuffer);

        // Clear existing cookies
        db.run('DELETE FROM cookies');

        // Insert cookies from backup
        const stmt = db.prepare(`
            INSERT INTO cookies (host_key, name, value, path, expires_utc, is_secure, is_httponly, creation_utc)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const cookie of cookies) {
            stmt.run([
                cookie.host_key,
                cookie.name,
                cookie.value,
                cookie.path,
                cookie.expires_utc || 0,
                cookie.is_secure || 0,
                cookie.is_httponly || 0,
                cookie.creation_utc || Date.now() * 1000
            ]);
        }

        stmt.free();

        // Save back to Chrome
        const data = db.export();
        db.close();
        fs.writeFileSync(cookiePath, Buffer.from(data));
        fs.unlinkSync(tempPath);

        console.log(`Restored ${cookies.length} cookies successfully!`);

    } catch (e) {
        console.error('Restore error:', e.message);
    }
};

// CLI interface
const args = process.argv.slice(2);
if (args[0] === 'backup') {
    backupCookies();
} else if (args[0] === 'restore' && args[1] && args[2]) {
    restoreCookies(args[1], args[2]);
} else if (args[0] === 'list') {
    const profiles = getChromeProfiles();
    console.log('Chrome Profiles:');
    profiles.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
} else {
    console.log(`
Chrome Cookie Backup Tool
=========================

Usage:
  node chrome-cookie-backup.js backup     - Backup all profile cookies
  node chrome-cookie-backup.js restore <profile> <backup-file>  - Restore cookies
  node chrome-cookie-backup.js list       - List all Chrome profiles

Examples:
  node chrome-cookie-backup.js backup
  node chrome-cookie-backup.js restore "Profile 1" cookie-backups/Profile_1_2024-01-15.json
    `);
}
