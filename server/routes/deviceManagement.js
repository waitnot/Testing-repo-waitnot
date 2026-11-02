/**
 * Device Management Routes
 * 
 * Trusted devices, session revocation, last-active tracking.
 * NOTE: trusted devices identify a device — they do NOT bypass staff authentication.
 * Every staff member must still authenticate with PIN/passkey on each session.
 */

import express from 'express';
import { query } from '../database/connection.js';
import { auditLog } from '../middleware/auth.js';

const router = express.Router();

// ── POST /api/devices/register ────────────────────────────────────────────────
// Register the current device as trusted for a staff member
router.post('/register-device', async (req, res) => {
  try {
    const { staffId, deviceFingerprint, deviceName, deviceType } = req.body;
    if (!staffId || !deviceFingerprint) {
      return res.status(400).json({ error: 'staffId and deviceFingerprint required' });
    }

    const r = await query(
      `INSERT INTO trusted_devices
         (staff_id, restaurant_id, device_fingerprint, device_name, device_type)
       SELECT id, restaurant_id, $2, $3, $4
       FROM staff WHERE id=$1 AND is_active=true
       ON CONFLICT (staff_id, device_fingerprint) DO UPDATE
         SET device_name=$3, device_type=$4, last_active=CURRENT_TIMESTAMP
       RETURNING id, device_name, device_type, last_login, last_active, is_trusted`,
      [staffId, deviceFingerprint, deviceName || 'Unknown Device', deviceType || 'web']
    );

    if (r.rows.length === 0) return res.status(404).json({ error: 'Staff not found' });
    res.json({ success: true, device: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/devices/staff/:staffId ──────────────────────────────────────────
router.get('/staff/:staffId', async (req, res) => {
  try {
    const r = await query(
      `SELECT id, device_name, device_type, last_login, last_active, is_trusted, created_at
       FROM trusted_devices WHERE staff_id=$1 ORDER BY last_active DESC`,
      [req.params.staffId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/devices/restaurant/:restaurantId ─────────────────────────────────
// Manager view — all devices for restaurant
router.get('/restaurant/:restaurantId', async (req, res) => {
  try {
    const r = await query(
      `SELECT td.id, td.device_name, td.device_type, td.last_login, td.last_active,
              td.is_trusted, s.name as staff_name, s.role
       FROM trusted_devices td
       JOIN staff s ON s.id = td.staff_id
       WHERE td.restaurant_id=$1
       ORDER BY td.last_active DESC`,
      [req.params.restaurantId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/devices/:deviceId ─────────────────────────────────────────────
// Revoke a single device
router.delete('/:deviceId', async (req, res) => {
  try {
    const { staffId } = req.body;
    const r = await query(
      'DELETE FROM trusted_devices WHERE id=$1 AND staff_id=$2 RETURNING device_name',
      [req.params.deviceId, staffId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Device not found' });

    const staff = await query('SELECT restaurant_id FROM staff WHERE id=$1', [staffId]);
    await auditLog(query, {
      entityType: 'staff', entityId: staffId, action: 'device_revoked',
      restaurantId: staff.rows[0]?.restaurant_id, req, success: true,
      metadata: { deviceName: r.rows[0].device_name }
    });

    res.json({ success: true, message: `Device "${r.rows[0].device_name}" revoked` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/devices/staff/:staffId/all ────────────────────────────────────
// Revoke all sessions + devices for a staff member (remote wipe)
router.delete('/staff/:staffId/all', async (req, res) => {
  try {
    const staffId = req.params.staffId;
    // Revoke all active sessions
    await query('DELETE FROM staff_sessions WHERE staff_id=$1', [staffId]);
    // Revoke all devices
    const r = await query('DELETE FROM trusted_devices WHERE staff_id=$1 RETURNING id', [staffId]);
    // Revoke all refresh tokens
    await query('UPDATE refresh_tokens SET revoked=true WHERE staff_id=$1', [staffId]);

    const staff = await query('SELECT restaurant_id FROM staff WHERE id=$1', [staffId]);
    await auditLog(query, {
      entityType: 'staff', entityId: staffId, action: 'all_sessions_revoked',
      restaurantId: staff.rows[0]?.restaurant_id, req, success: true,
      metadata: { devicesRevoked: r.rowCount }
    });

    res.json({ success: true, message: 'All sessions and devices revoked', devicesRevoked: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/devices/:deviceId/active ───────────────────────────────────────
// Update last_active timestamp — called periodically by the client
router.patch('/:deviceId/active', async (req, res) => {
  try {
    await query(
      'UPDATE trusted_devices SET last_active=CURRENT_TIMESTAMP WHERE id=$1',
      [req.params.deviceId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/devices/audit/:restaurantId ─────────────────────────────────────
// Login audit log for restaurant (manager view)
router.get('/audit/:restaurantId', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = await query(
      `SELECT lal.id, lal.entity_type, lal.entity_id, lal.action,
              lal.success, lal.failure_reason, lal.ip_address,
              lal.created_at, s.name as staff_name
       FROM login_audit_log lal
       LEFT JOIN staff s ON s.id::text = lal.entity_id AND lal.entity_type='staff'
       WHERE lal.restaurant_id=$1
       ORDER BY lal.created_at DESC
       LIMIT $2`,
      [req.params.restaurantId, limit]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
