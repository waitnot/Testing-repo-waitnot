/**
 * TOTP (Time-based One-Time Password) Routes — Admin 2FA
 *
 * Uses otpauth (RFC 6238 compliant).
 * Compatible with: Google Authenticator, Authy, 1Password, etc.
 *
 * Flow:
 *   1. POST /api/totp/setup      → returns secret + QR code URI
 *   2. POST /api/totp/verify-setup → confirm first TOTP code, activate 2FA + return recovery codes
 *   3. POST /api/totp/validate   → validate code during login
 *   4. POST /api/totp/disable    → disable 2FA (requires current code)
 *   5. POST /api/totp/recover    → use recovery code to bypass TOTP
 */

import express from 'express';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../database/connection.js';
import { JWT_SECRET, rateLimit, auditLog } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Number of recovery codes to generate
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 10; // chars

// ── Add TOTP tables if not already created ────────────────────────────────────
// (Also handled in connection.js but we add here for completeness during route init)
async function ensureTotpTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS admin_totp (
      id SERIAL PRIMARY KEY,
      admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      secret_encrypted TEXT NOT NULL,
      is_active BOOLEAN DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      activated_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(admin_id)
    )
  `).catch(() => {});

  await query(`
    CREATE TABLE IF NOT EXISTS admin_recovery_codes (
      id SERIAL PRIMARY KEY,
      admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      code_hash VARCHAR(255) NOT NULL,
      used BOOLEAN DEFAULT false,
      used_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `).catch(() => {});
}

ensureTotpTables();

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateSecret() {
  return new OTPAuth.Secret({ size: 20 });
}

function createTotp(secret) {
  return new OTPAuth.TOTP({
    issuer: 'WaitNot',
    label: 'WaitNot Admin',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
}

// Encrypt the TOTP secret with AES-256-GCM using APP_SECRET
function encryptSecret(plaintext) {
  const key = crypto.scryptSync(
    process.env.JWT_SECRET || 'waitnot-dev-secret-change-in-production',
    'waitnot-totp-salt',
    32
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(ciphertext) {
  const key = crypto.scryptSync(
    process.env.JWT_SECRET || 'waitnot-dev-secret-change-in-production',
    'waitnot-totp-salt',
    32
  );
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    crypto.randomBytes(RECOVERY_CODE_LENGTH).toString('base64url').slice(0, RECOVERY_CODE_LENGTH).toUpperCase()
  );
}

async function getAdminFromToken(req) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return null;
    const r = await query('SELECT * FROM admins WHERE id=$1', [decoded.id]);
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

// ── POST /api/totp/setup ──────────────────────────────────────────────────────
// Generate a new TOTP secret and return QR code
router.post('/setup', rateLimit, async (req, res) => {
  try {
    const admin = await getAdminFromToken(req);
    if (!admin) return res.status(401).json({ error: 'Admin authentication required' });

    const secret = generateSecret();
    const totp = createTotp(secret);
    totp.label = `WaitNot (${admin.email || admin.username})`;

    const otpUri = totp.toString();
    const qrCodeDataUrl = await QRCode.toDataURL(otpUri);

    // Store encrypted secret (not yet active)
    await query(
      `INSERT INTO admin_totp (admin_id, secret_encrypted, is_active)
       VALUES ($1,$2,false)
       ON CONFLICT (admin_id) DO UPDATE
         SET secret_encrypted=$2, is_active=false, activated_at=NULL`,
      [admin.id, encryptSecret(secret.base32)]
    );

    res.json({
      qrCodeDataUrl,
      manualKey: secret.base32, // for manual entry in authenticator app
      message: 'Scan the QR code with your authenticator app, then verify with a code.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/totp/verify-setup ───────────────────────────────────────────────
// Confirm first TOTP code, activate 2FA, return recovery codes
router.post('/verify-setup', rateLimit, async (req, res) => {
  try {
    const admin = await getAdminFromToken(req);
    if (!admin) return res.status(401).json({ error: 'Admin authentication required' });

    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'TOTP code required' });

    const totpRecord = await query(
      'SELECT * FROM admin_totp WHERE admin_id=$1 AND is_active=false',
      [admin.id]
    );
    if (totpRecord.rows.length === 0) {
      return res.status(400).json({ error: 'No pending 2FA setup. Please run setup first.' });
    }

    const secretBase32 = decryptSecret(totpRecord.rows[0].secret_encrypted);
    const totp = createTotp(OTPAuth.Secret.fromBase32(secretBase32));

    const delta = totp.validate({ token: String(code).replace(/\s/g, ''), window: 1 });
    if (delta === null) {
      return res.status(401).json({ error: 'Invalid TOTP code. Make sure your device clock is correct.' });
    }

    // Activate 2FA
    await query(
      'UPDATE admin_totp SET is_active=true, activated_at=CURRENT_TIMESTAMP WHERE admin_id=$1',
      [admin.id]
    );

    // Generate and store recovery codes (hashed)
    const codes = generateRecoveryCodes();
    await query('DELETE FROM admin_recovery_codes WHERE admin_id=$1', [admin.id]);
    for (const code of codes) {
      const hash = await bcrypt.hash(code, 10);
      await query(
        'INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1,$2)',
        [admin.id, hash]
      );
    }

    await auditLog(query, {
      entityType: 'admin', entityId: admin.id, action: 'totp_enabled',
      req, success: true
    });

    res.json({
      success: true,
      message: '2FA activated. Save these recovery codes in a safe place — they will only be shown once.',
      recoveryCodes: codes, // plaintext — shown only once
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/totp/validate ───────────────────────────────────────────────────
// Validate TOTP during login — called after password check if 2FA is active
router.post('/validate', rateLimit, async (req, res) => {
  try {
    const { adminId, code } = req.body;
    if (!adminId || !code) return res.status(400).json({ error: 'adminId and code required' });

    const totpRecord = await query(
      'SELECT * FROM admin_totp WHERE admin_id=$1 AND is_active=true',
      [adminId]
    );
    if (totpRecord.rows.length === 0) {
      return res.status(400).json({ error: '2FA not enabled for this account' });
    }

    const secretBase32 = decryptSecret(totpRecord.rows[0].secret_encrypted);
    const totp = createTotp(OTPAuth.Secret.fromBase32(secretBase32));
    const delta = totp.validate({ token: String(code).replace(/\s/g, ''), window: 1 });

    if (delta === null) {
      await auditLog(query, {
        entityType: 'admin', entityId: adminId, action: 'totp_fail',
        req, success: false, failureReason: 'invalid_code'
      });
      return res.status(401).json({ error: 'Invalid TOTP code' });
    }

    // Issue a short-lived "2FA verified" token that the client exchanges for full JWT
    const verifiedToken = jwt.sign(
      { adminId, totpVerified: true, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    await auditLog(query, {
      entityType: 'admin', entityId: adminId, action: 'totp_verified',
      req, success: true
    });

    res.json({ success: true, verifiedToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/totp/recover ────────────────────────────────────────────────────
// Use a recovery code to bypass TOTP (one-time use)
router.post('/recover', rateLimit, async (req, res) => {
  try {
    const { adminId, recoveryCode } = req.body;
    if (!adminId || !recoveryCode) return res.status(400).json({ error: 'adminId and recoveryCode required' });

    const codesResult = await query(
      'SELECT * FROM admin_recovery_codes WHERE admin_id=$1 AND used=false',
      [adminId]
    );

    let matchedId = null;
    for (const row of codesResult.rows) {
      const match = await bcrypt.compare(recoveryCode.toUpperCase().replace(/\s/g, ''), row.code_hash);
      if (match) { matchedId = row.id; break; }
    }

    if (!matchedId) {
      await auditLog(query, {
        entityType: 'admin', entityId: adminId, action: 'recovery_code_fail',
        req, success: false, failureReason: 'invalid_code'
      });
      return res.status(401).json({ error: 'Invalid recovery code' });
    }

    // Mark code as used
    await query(
      'UPDATE admin_recovery_codes SET used=true, used_at=CURRENT_TIMESTAMP WHERE id=$1',
      [matchedId]
    );

    // Remaining unused codes
    const remaining = await query(
      'SELECT COUNT(*) as count FROM admin_recovery_codes WHERE admin_id=$1 AND used=false',
      [adminId]
    );
    const remainingCount = parseInt(remaining.rows[0].count);

    const verifiedToken = jwt.sign(
      { adminId, totpVerified: true, role: 'admin', method: 'recovery' },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    await auditLog(query, {
      entityType: 'admin', entityId: adminId, action: 'recovery_code_used',
      req, success: true, metadata: { remainingCodes: remainingCount }
    });

    res.json({
      success: true,
      verifiedToken,
      remainingCodes: remainingCount,
      warning: remainingCount <= 2 ? `Only ${remainingCount} recovery code(s) left. Consider regenerating.` : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/totp/disable ────────────────────────────────────────────────────
// Disable 2FA — requires current valid TOTP code
router.post('/disable', rateLimit, async (req, res) => {
  try {
    const admin = await getAdminFromToken(req);
    if (!admin) return res.status(401).json({ error: 'Admin authentication required' });

    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Current TOTP code required to disable 2FA' });

    const totpRecord = await query(
      'SELECT * FROM admin_totp WHERE admin_id=$1 AND is_active=true',
      [admin.id]
    );
    if (totpRecord.rows.length === 0) {
      return res.status(400).json({ error: '2FA is not currently active' });
    }

    const secretBase32 = decryptSecret(totpRecord.rows[0].secret_encrypted);
    const totp = createTotp(OTPAuth.Secret.fromBase32(secretBase32));
    const delta = totp.validate({ token: String(code).replace(/\s/g, ''), window: 1 });

    if (delta === null) return res.status(401).json({ error: 'Invalid TOTP code' });

    await query('DELETE FROM admin_totp WHERE admin_id=$1', [admin.id]);
    await query('DELETE FROM admin_recovery_codes WHERE admin_id=$1', [admin.id]);

    await auditLog(query, {
      entityType: 'admin', entityId: admin.id, action: 'totp_disabled',
      req, success: true
    });

    res.json({ success: true, message: '2FA disabled successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/totp/status ──────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const admin = await getAdminFromToken(req);
    if (!admin) return res.status(401).json({ error: 'Admin authentication required' });

    const r = await query('SELECT is_active, activated_at FROM admin_totp WHERE admin_id=$1', [admin.id]);
    const codesLeft = r.rows[0]?.is_active
      ? (await query('SELECT COUNT(*) as n FROM admin_recovery_codes WHERE admin_id=$1 AND used=false', [admin.id])).rows[0].n
      : 0;

    res.json({
      enabled: r.rows[0]?.is_active || false,
      activatedAt: r.rows[0]?.activated_at || null,
      recoveryCodesRemaining: parseInt(codesLeft),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
