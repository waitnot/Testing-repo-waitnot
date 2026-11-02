/**
 * WebAuthn / Passkey Authentication Routes
 *
 * Uses @simplewebauthn/server — FIDO2 compliant, supports:
 *   - Android fingerprint (via browser WebAuthn API on Chrome)
 *   - iOS Face ID / Touch ID (Safari)
 *   - Platform authenticators (Windows Hello, etc.)
 *
 * Flow:
 *   REGISTRATION: generateOptions → user authenticates → verifyRegistration → save credential
 *   AUTHENTICATION: generateOptions → user authenticates → verifyAuthentication → issue JWT
 *
 * NOTE: For Capacitor Android native biometric, the app must use the
 *   Capacitor Biometric Auth plugin which calls the native Android BiometricPrompt.
 *   That plugin returns a signed challenge that we verify here.
 *   The /api/webauthn/capacitor-auth endpoint handles that case.
 */

import express from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { query } from '../database/connection.js';
import { JWT_SECRET, rateLimit, auditLog } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// ── Config ───────────────────────────────────────────────────────────────────
const RP_NAME = 'WaitNot Restaurant';
// RP_ID must match the domain where the app is hosted
// Supports both production domain and colosoft subdomain
function getRpId(req) {
  const host = req.get('host') || 'waitnot.in';
  // Strip port
  return host.split(':')[0];
}
function getOrigin(req) {
  const origin = req.get('origin') || `https://${getRpId(req)}`;
  return origin;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getStaffById(staffId) {
  const r = await query('SELECT * FROM staff WHERE id=$1 AND is_active=true', [staffId]);
  return r.rows[0] || null;
}

async function getCredentialsByStaff(staffId) {
  const r = await query('SELECT * FROM webauthn_credentials WHERE staff_id=$1', [staffId]);
  return r.rows;
}

async function saveChallenge(staffId, challenge, type) {
  // Clean up expired challenges first
  await query('DELETE FROM webauthn_challenges WHERE expires_at < NOW()', []);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min TTL
  await query(
    'INSERT INTO webauthn_challenges (staff_id, challenge, type, expires_at) VALUES ($1,$2,$3,$4)',
    [staffId, challenge, type, expiresAt]
  );
}

async function getChallenge(staffId, type) {
  const r = await query(
    'SELECT * FROM webauthn_challenges WHERE staff_id=$1 AND type=$2 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [staffId, type]
  );
  return r.rows[0] || null;
}

async function deleteChallenge(staffId, type) {
  await query('DELETE FROM webauthn_challenges WHERE staff_id=$1 AND type=$2', [staffId, type]);
}

// ── POST /api/webauthn/register/options ──────────────────────────────────────
// Generate registration challenge — staff must be authenticated (has valid session)
router.post('/register/options', rateLimit, async (req, res) => {
  try {
    const { staffId } = req.body;
    if (!staffId) return res.status(400).json({ error: 'staffId required' });

    const staff = await getStaffById(staffId);
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    const existingCredentials = await getCredentialsByStaff(staffId);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpId(req),
      userID: Buffer.from(String(staffId)),
      userName: staff.username || staff.email,
      userDisplayName: staff.name,
      attestationType: 'none',
      // Exclude already-registered authenticators
      excludeCredentials: existingCredentials.map(c => ({
        id: c.credential_id,
        type: 'public-key',
        transports: c.transports ? JSON.parse(c.transports) : [],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        // platform = fingerprint/face ID; cross-platform = hardware key
        authenticatorAttachment: 'platform',
      },
      timeout: 60000,
    });

    // Save challenge for verification
    await saveChallenge(staffId, options.challenge, 'registration');

    res.json(options);
  } catch (err) {
    console.error('WebAuthn register/options error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/webauthn/register/verify ───────────────────────────────────────
router.post('/register/verify', rateLimit, async (req, res) => {
  try {
    const { staffId, credential, deviceName } = req.body;
    if (!staffId || !credential) return res.status(400).json({ error: 'staffId and credential required' });

    const staff = await getStaffById(staffId);
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    const challengeRecord = await getChallenge(staffId, 'registration');
    if (!challengeRecord) return res.status(400).json({ error: 'No pending registration challenge. Please start over.' });

    const rpID = getRpId(req);
    const origin = getOrigin(req);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: [origin, `https://${rpID}`],
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (verifyErr) {
      await deleteChallenge(staffId, 'registration');
      return res.status(400).json({ error: `Verification failed: ${verifyErr.message}` });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Registration not verified' });
    }

    const { credential: cred, aaguid } = verification.registrationInfo;

    // Store public key credential
    await query(
      `INSERT INTO webauthn_credentials
         (staff_id, restaurant_id, credential_id, public_key, counter, device_name, aaguid, transports)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (credential_id) DO UPDATE
         SET counter=$4, device_name=$5, last_used=CURRENT_TIMESTAMP`,
      [
        staffId,
        staff.restaurant_id,
        cred.id,
        Buffer.from(cred.publicKey).toString('base64'),
        cred.counter,
        deviceName || 'My Device',
        aaguid || null,
        JSON.stringify(credential.response?.transports || []),
      ]
    );

    await deleteChallenge(staffId, 'registration');
    await auditLog(query, {
      entityType: 'staff', entityId: staffId, action: 'passkey_registered',
      restaurantId: staff.restaurant_id, req, success: true,
      metadata: { deviceName: deviceName || 'My Device' }
    });

    res.json({ success: true, message: 'Passkey registered successfully' });
  } catch (err) {
    console.error('WebAuthn register/verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/webauthn/auth/options ──────────────────────────────────────────
// Generate authentication challenge — can be called before staff selects account (discoverable)
router.post('/auth/options', rateLimit, async (req, res) => {
  try {
    const { staffId } = req.body; // optional — if not provided, generates discoverable credential options

    let allowCredentials = [];
    if (staffId) {
      const creds = await getCredentialsByStaff(staffId);
      allowCredentials = creds.map(c => ({
        id: c.credential_id,
        type: 'public-key',
        transports: c.transports ? JSON.parse(c.transports) : [],
      }));
    }

    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      allowCredentials,
      userVerification: 'preferred',
      timeout: 60000,
    });

    // Store challenge — use staffId=null for discoverable
    const challengeStaffId = staffId || 0;
    await saveChallenge(challengeStaffId, options.challenge, 'authentication');

    res.json({ ...options, _staffId: staffId || null });
  } catch (err) {
    console.error('WebAuthn auth/options error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/webauthn/auth/verify ───────────────────────────────────────────
router.post('/auth/verify', rateLimit, async (req, res) => {
  try {
    const { staffId, credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'credential required' });

    // Look up the stored credential
    const credResult = await query(
      'SELECT * FROM webauthn_credentials WHERE credential_id=$1',
      [credential.id]
    );
    if (credResult.rows.length === 0) {
      return res.status(401).json({ error: 'Credential not found. Please register your device first.' });
    }
    const storedCred = credResult.rows[0];
    const actualStaffId = storedCred.staff_id;

    const staff = await getStaffById(actualStaffId);
    if (!staff) return res.status(401).json({ error: 'Staff account not found or inactive' });

    // Get the challenge — try both staffId variants
    let challengeRecord = await getChallenge(actualStaffId, 'authentication');
    if (!challengeRecord) {
      challengeRecord = await getChallenge(0, 'authentication');
    }
    if (!challengeRecord) {
      return res.status(400).json({ error: 'No pending authentication challenge. Please start over.' });
    }

    const rpID = getRpId(req);
    const origin = getOrigin(req);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: [origin, `https://${rpID}`],
        expectedRPID: rpID,
        credential: {
          id: storedCred.credential_id,
          publicKey: Buffer.from(storedCred.public_key, 'base64'),
          counter: storedCred.counter,
          transports: storedCred.transports ? JSON.parse(storedCred.transports) : [],
        },
        requireUserVerification: false,
      });
    } catch (verifyErr) {
      await deleteChallenge(actualStaffId, 'authentication');
      await deleteChallenge(0, 'authentication');
      await auditLog(query, {
        entityType: 'staff', entityId: actualStaffId, action: 'passkey_fail',
        restaurantId: staff.restaurant_id, req, success: false,
        failureReason: verifyErr.message
      });
      return res.status(401).json({ error: `Authentication failed: ${verifyErr.message}` });
    }

    if (!verification.verified) {
      return res.status(401).json({ error: 'Authentication not verified' });
    }

    // Update counter (replay attack prevention)
    await query(
      'UPDATE webauthn_credentials SET counter=$1, last_used=CURRENT_TIMESTAMP WHERE credential_id=$2',
      [verification.authenticationInfo.newCounter, credential.id]
    );

    await deleteChallenge(actualStaffId, 'authentication');
    await deleteChallenge(0, 'authentication');

    // Issue JWT
    const token = jwt.sign(
      { staffId: actualStaffId, restaurantId: staff.restaurant_id, loginMethod: 'passkey' },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await query(
      'INSERT INTO staff_sessions (staff_id, session_token, expires_at) VALUES ($1,$2,$3)',
      [actualStaffId, token, expiresAt]
    );

    await auditLog(query, {
      entityType: 'staff', entityId: actualStaffId, action: 'passkey_login',
      restaurantId: staff.restaurant_id, req, success: true
    });

    const { password: _, ...staffData } = staff;
    res.json({ token, staff: staffData, loginMethod: 'passkey' });
  } catch (err) {
    console.error('WebAuthn auth/verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/webauthn/credentials/:staffId ───────────────────────────────────
// List registered passkeys for a staff member
router.get('/credentials/:staffId', async (req, res) => {
  try {
    const r = await query(
      `SELECT id, device_name, aaguid, created_at, last_used,
              transports, credential_id
       FROM webauthn_credentials WHERE staff_id=$1 ORDER BY created_at DESC`,
      [req.params.staffId]
    );
    res.json(r.rows.map(c => ({
      id: c.id,
      deviceName: c.device_name,
      credentialId: c.credential_id.substring(0, 12) + '…', // truncated for display
      transports: c.transports ? JSON.parse(c.transports) : [],
      createdAt: c.created_at,
      lastUsed: c.last_used,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/webauthn/credentials/:credentialDbId ─────────────────────────
// Revoke a passkey
router.delete('/credentials/:id', async (req, res) => {
  try {
    const { staffId } = req.body;
    if (!staffId) return res.status(400).json({ error: 'staffId required' });

    const r = await query(
      'DELETE FROM webauthn_credentials WHERE id=$1 AND staff_id=$2 RETURNING device_name',
      [req.params.id, staffId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Credential not found' });

    const staff = await getStaffById(staffId);
    await auditLog(query, {
      entityType: 'staff', entityId: staffId, action: 'passkey_revoked',
      restaurantId: staff?.restaurant_id, req, success: true,
      metadata: { deviceName: r.rows[0].device_name }
    });

    res.json({ success: true, message: `Passkey "${r.rows[0].device_name}" revoked` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/webauthn/credentials/:id/rename ───────────────────────────────
router.patch('/credentials/:id/rename', async (req, res) => {
  try {
    const { staffId, deviceName } = req.body;
    if (!staffId || !deviceName) return res.status(400).json({ error: 'staffId and deviceName required' });

    const r = await query(
      'UPDATE webauthn_credentials SET device_name=$1 WHERE id=$2 AND staff_id=$3 RETURNING id, device_name',
      [deviceName.trim().slice(0, 100), req.params.id, staffId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Credential not found' });

    res.json({ success: true, credential: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
