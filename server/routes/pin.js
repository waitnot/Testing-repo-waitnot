/**
 * PIN Authentication Routes
 * Handles staff PIN set / login / reset / remove.
 *
 * All PINs are hashed with bcrypt (rounds=12) — never stored plaintext.
 * Brute-force protection: 5 failed attempts → 15-minute lockout, doubling each time.
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../database/connection.js';
import { JWT_SECRET, rateLimit, auditLog } from '../middleware/auth.js';

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 15;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getStaffById(staffId) {
  const r = await query('SELECT * FROM staff WHERE id=$1 AND is_active=true', [staffId]);
  return r.rows[0] || null;
}

async function getPinRecord(staffId) {
  const r = await query('SELECT * FROM staff_pins WHERE staff_id=$1', [staffId]);
  return r.rows[0] || null;
}

function isLocked(pin) {
  if (!pin) return false;
  if (!pin.locked_until) return false;
  return new Date(pin.locked_until) > new Date();
}

async function recordFailure(staffId, currentFailed) {
  const newFailed = currentFailed + 1;
  let lockedUntil = null;
  if (newFailed >= MAX_FAILED) {
    const multiplier = Math.pow(2, Math.floor((newFailed - MAX_FAILED) / MAX_FAILED));
    const minutes = LOCKOUT_MINUTES * multiplier;
    lockedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }
  await query(
    `UPDATE staff_pins SET failed_attempts=$1, locked_until=$2, updated_at=CURRENT_TIMESTAMP WHERE staff_id=$3`,
    [newFailed, lockedUntil, staffId]
  );
  return { newFailed, lockedUntil };
}

async function clearFailures(staffId) {
  await query(
    `UPDATE staff_pins SET failed_attempts=0, locked_until=NULL, updated_at=CURRENT_TIMESTAMP WHERE staff_id=$1`,
    [staffId]
  );
}

// ── GET /api/pin/restaurant/:restaurantId/profiles ────────────────────────────
// Public endpoint — returns staff list (no passwords/pins) for shared-tablet UI
router.get('/restaurant/:restaurantId/profiles', async (req, res) => {
  try {
    const result = await query(
      `SELECT s.id, s.name, s.role, s.waiter_number, s.username,
              (sp.id IS NOT NULL) AS has_pin
       FROM staff s
       LEFT JOIN staff_pins sp ON sp.staff_id = s.id
       WHERE s.restaurant_id=$1 AND s.is_active=true
       ORDER BY s.name ASC`,
      [req.params.restaurantId]
    );

    // Return initials colour for avatar
    const profiles = result.rows.map(s => ({
      id: s.id,
      name: s.name,
      role: s.role,
      waiterNumber: s.waiter_number,
      username: s.username,
      hasPin: s.has_pin,
      initials: s.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
    }));

    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pin/set ─────────────────────────────────────────────────────────
// Set or update own PIN — requires current password OR current PIN (first-time setup uses password)
router.post('/set', rateLimit, async (req, res) => {
  try {
    const { staffId, pin, currentPassword, currentPin } = req.body;

    if (!staffId || !pin) return res.status(400).json({ error: 'staffId and pin are required' });
    if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4–6 digits' });
    }

    const staff = await getStaffById(staffId);
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    const existingPin = await getPinRecord(staffId);

    // Verify identity: if PIN already set, require currentPin; otherwise require currentPassword
    if (existingPin) {
      if (!currentPin) return res.status(400).json({ error: 'Current PIN required to change PIN' });
      if (isLocked(existingPin)) {
        return res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
      }
      const pinOk = await bcrypt.compare(String(currentPin), existingPin.pin_hash);
      if (!pinOk) {
        await recordFailure(staffId, existingPin.failed_attempts);
        return res.status(401).json({ error: 'Current PIN is incorrect' });
      }
    } else {
      if (!currentPassword) return res.status(400).json({ error: 'Password required to set PIN for the first time' });
      const pwOk = await bcrypt.compare(currentPassword, staff.password);
      if (!pwOk) return res.status(401).json({ error: 'Password is incorrect' });
    }

    const pinHash = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);

    if (existingPin) {
      await query(
        `UPDATE staff_pins SET pin_hash=$1, failed_attempts=0, locked_until=NULL, updated_at=CURRENT_TIMESTAMP WHERE staff_id=$2`,
        [pinHash, staffId]
      );
    } else {
      await query(
        `INSERT INTO staff_pins (staff_id, restaurant_id, pin_hash) VALUES ($1,$2,$3)`,
        [staffId, staff.restaurant_id, pinHash]
      );
    }

    await auditLog(query, { entityType: 'staff', entityId: staffId, action: 'pin_set', restaurantId: staff.restaurant_id, req, success: true });
    res.json({ success: true, message: 'PIN set successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pin/login ───────────────────────────────────────────────────────
// Authenticate with staffId + PIN — returns JWT + session
router.post('/login', rateLimit, async (req, res) => {
  try {
    const { staffId, pin } = req.body;

    if (!staffId || !pin) return res.status(400).json({ error: 'staffId and pin are required' });

    const staff = await getStaffById(staffId);
    if (!staff) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const pinRecord = await getPinRecord(staffId);
    if (!pinRecord) {
      return res.status(401).json({ error: 'No PIN set. Please set a PIN or use email/password login.' });
    }

    // Check lockout
    if (isLocked(pinRecord)) {
      const retryAt = new Date(pinRecord.locked_until);
      const waitMin = Math.ceil((retryAt - Date.now()) / 60000);
      await auditLog(query, { entityType: 'staff', entityId: staffId, action: 'pin_fail', restaurantId: staff.restaurant_id, req, success: false, failureReason: 'locked', metadata: { waitMin } });
      return res.status(423).json({
        error: `Account locked after too many failed attempts. Try again in ${waitMin} minute${waitMin !== 1 ? 's' : ''}.`,
        lockedUntil: pinRecord.locked_until,
      });
    }

    const valid = await bcrypt.compare(String(pin), pinRecord.pin_hash);
    if (!valid) {
      const { newFailed, lockedUntil } = await recordFailure(staffId, pinRecord.failed_attempts);
      await auditLog(query, { entityType: 'staff', entityId: staffId, action: 'pin_fail', restaurantId: staff.restaurant_id, req, success: false, failureReason: 'wrong_pin', metadata: { attempts: newFailed } });

      const remaining = MAX_FAILED - newFailed;
      if (remaining <= 0) {
        const waitMin = LOCKOUT_MINUTES;
        return res.status(423).json({ error: `Account locked. Try again in ${waitMin} minutes.`, lockedUntil });
      }
      return res.status(401).json({ error: `Incorrect PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`, attemptsRemaining: remaining });
    }

    // Success — clear failures, create session
    await clearFailures(staffId);

    const token = jwt.sign(
      { staffId: staff.id, restaurantId: staff.restaurant_id, loginMethod: 'pin' },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await query(
      'INSERT INTO staff_sessions (staff_id, session_token, expires_at) VALUES ($1,$2,$3)',
      [staff.id, token, expiresAt]
    );

    await auditLog(query, { entityType: 'staff', entityId: staffId, action: 'pin_login', restaurantId: staff.restaurant_id, req, success: true });

    const { password: _, ...staffData } = staff;
    res.json({
      token,
      staff: { ...staffData, roleDetails: STAFF_ROLES[staff.role] || null },
      loginMethod: 'pin',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pin/reset ───────────────────────────────────────────────────────
// Manager resets a staff PIN — requires requester to be manager/owner of same restaurant
router.post('/reset', rateLimit, async (req, res) => {
  try {
    const { requesterId, targetStaffId, newPin } = req.body;

    if (!requesterId || !targetStaffId) return res.status(400).json({ error: 'requesterId and targetStaffId are required' });

    // Verify requester is an active manager/owner of same restaurant
    const requester = await getStaffById(requesterId);
    if (!requester || !['manager'].includes(requester.role)) {
      return res.status(403).json({ error: 'Only managers can reset staff PINs' });
    }

    const target = await getStaffById(targetStaffId);
    if (!target || target.restaurant_id !== requester.restaurant_id) {
      return res.status(404).json({ error: 'Staff not found in your restaurant' });
    }

    if (newPin) {
      // Set a specific new PIN
      if (newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) {
        return res.status(400).json({ error: 'PIN must be 4–6 digits' });
      }
      const pinHash = await bcrypt.hash(String(newPin), BCRYPT_ROUNDS);
      await query(
        `INSERT INTO staff_pins (staff_id, restaurant_id, pin_hash)
         VALUES ($1,$2,$3)
         ON CONFLICT (staff_id) DO UPDATE
           SET pin_hash=$3, failed_attempts=0, locked_until=NULL, updated_at=CURRENT_TIMESTAMP`,
        [targetStaffId, target.restaurant_id, pinHash]
      );
    } else {
      // Remove PIN — staff must re-set via password
      await query('DELETE FROM staff_pins WHERE staff_id=$1', [targetStaffId]);
    }

    await auditLog(query, { entityType: 'staff', entityId: requesterId, action: 'pin_reset', restaurantId: requester.restaurant_id, req, success: true, metadata: { targetStaffId } });
    res.json({ success: true, message: newPin ? 'PIN reset successfully' : 'PIN removed — staff must set a new PIN' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pin/unlock ──────────────────────────────────────────────────────
// Manager unlocks a locked staff account (clears failed attempts + lockout)
router.post('/unlock', async (req, res) => {
  try {
    const { requesterId, targetStaffId } = req.body;

    const requester = await getStaffById(requesterId);
    if (!requester || requester.role !== 'manager') {
      return res.status(403).json({ error: 'Only managers can unlock accounts' });
    }
    const target = await getStaffById(targetStaffId);
    if (!target || target.restaurant_id !== requester.restaurant_id) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    await clearFailures(targetStaffId);
    await auditLog(query, { entityType: 'staff', entityId: requesterId, action: 'pin_unlock', restaurantId: requester.restaurant_id, req, success: true, metadata: { targetStaffId } });
    res.json({ success: true, message: 'Account unlocked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/pin/status/:staffId ──────────────────────────────────────────────
// Check if staff has PIN set and lock status (no PIN value exposed)
router.get('/status/:staffId', async (req, res) => {
  try {
    const pinRecord = await getPinRecord(req.params.staffId);
    if (!pinRecord) return res.json({ hasPin: false });

    res.json({
      hasPin: true,
      isLocked: isLocked(pinRecord),
      lockedUntil: pinRecord.locked_until || null,
      failedAttempts: pinRecord.failed_attempts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Staff roles (mirrored from staff.js to avoid circular import) ─────────────
const STAFF_ROLES = {
  manager: { name: 'Manager', permissions: { orders: { view: true, edit: true, delete: true }, menu: { view: true, edit: true, delete: true }, staff: { view: true, edit: true, delete: true }, analytics: { view: true }, settings: { view: true, edit: true } } },
  waiter:  { name: 'Waiter',  permissions: { orders: { view: true, edit: true, delete: false }, menu: { view: true, edit: false, delete: false }, staff: { view: false, edit: false, delete: false }, settings: { view: false, edit: false } } },
  kitchen: { name: 'Kitchen Staff', permissions: { orders: { view: true, edit: true, delete: false }, menu: { view: true, edit: false, delete: false }, staff: { view: false, edit: false, delete: false }, analytics: { view: false }, settings: { view: false, edit: false } } },
};

export default router;
