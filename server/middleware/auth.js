import jwt from 'jsonwebtoken';

// ── Shared JWT secret — single source of truth ───────────────────────────────
// All routes must use this. Never use fallback strings directly in route files.
export const JWT_SECRET = process.env.JWT_SECRET || 'waitnot-dev-secret-change-in-production';

// ── In-memory rate limiting (per IP) ─────────────────────────────────────────
// Simple map: ip → { count, resetAt }
// For production scale, swap this for Redis.
const rateLimitMap = new Map();

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 20;                     // max attempts per window

function getRateKey(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
}

export function rateLimit(req, res, next) {
  const key = getRateKey(req);
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  record.count += 1;
  if (record.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfterSeconds: retryAfter,
    });
  }

  next();
}

// Clean up rate limit map every 30 minutes to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) rateLimitMap.delete(key);
  }
}, 30 * 60 * 1000);

// ── Restaurant / generic token auth ──────────────────────────────────────────
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ── Admin token auth ──────────────────────────────────────────────────────────
export const authenticateAdmin = (req, res, next) => {
  authenticateToken(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
};

// ── Audit log helper (non-blocking) ──────────────────────────────────────────
// Import lazily to avoid circular deps with connection.js
export async function auditLog(db, {
  entityType,   // 'staff' | 'restaurant' | 'admin'
  entityId,     // string id
  action,       // 'login' | 'logout' | 'pin_login' | 'pin_fail' | 'lockout' | 'passkey_login' | 'staff_switch' | 'pin_set' | 'pin_reset'
  restaurantId = null,
  req = null,
  success = true,
  failureReason = null,
  metadata = {},
}) {
  try {
    await db(
      `INSERT INTO login_audit_log
       (entity_type, entity_id, action, restaurant_id, ip_address, user_agent, success, failure_reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        entityType,
        String(entityId),
        action,
        restaurantId,
        req ? (req.ip || req.headers['x-forwarded-for']?.split(',')[0] || null) : null,
        req ? (req.headers['user-agent'] || null) : null,
        success,
        failureReason,
        JSON.stringify(metadata),
      ]
    );
  } catch (_) {
    // audit log must never crash the request
  }
}
