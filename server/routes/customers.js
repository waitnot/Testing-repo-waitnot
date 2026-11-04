/**
 * Customer Management Routes
 *
 * Customers are auto-created/updated when a delivery or takeaway order is placed
 * with a name + phone. No manual creation needed.
 *
 * Endpoints:
 *   GET  /api/customers/:restaurantId              — list all customers (paginated)
 *   GET  /api/customers/:restaurantId/search       — search by name/phone/food ordered
 *   GET  /api/customers/:restaurantId/suggest      — autocomplete by partial name or phone
 *   POST /api/customers/:restaurantId/upsert       — create or update (called from orders)
 */

import express from 'express';
import { query } from '../database/connection.js';

const router = express.Router();

// ── Auto-upsert when an order is placed ──────────────────────────────────────
// Called internally from orders route — not exposed publicly
export async function upsertCustomer(restaurantId, { name, phone, address }) {
  if (!name && !phone) return; // nothing to save
  try {
    if (phone) {
      // Try to find existing by phone first
      const existing = await query(
        `SELECT id FROM customers WHERE restaurant_id=$1 AND phone=$2 LIMIT 1`,
        [restaurantId, phone.trim()]
      );
      if (existing.rows.length > 0) {
        // Update existing
        await query(
          `UPDATE customers
           SET name=$1, address=COALESCE(NULLIF($2,''), address),
               last_order_at=CURRENT_TIMESTAMP, order_count=order_count+1,
               updated_at=CURRENT_TIMESTAMP
           WHERE id=$3`,
          [name?.trim() || '', address?.trim() || '', existing.rows[0].id]
        );
        return;
      }
    }
    // Check by name if no phone match
    if (name) {
      const byName = await query(
        `SELECT id FROM customers
         WHERE restaurant_id=$1 AND LOWER(name)=LOWER($2) AND (phone IS NULL OR phone='')
         LIMIT 1`,
        [restaurantId, name.trim()]
      );
      if (byName.rows.length > 0) {
        await query(
          `UPDATE customers
           SET phone=COALESCE(NULLIF($1,''), phone),
               address=COALESCE(NULLIF($2,''), address),
               last_order_at=CURRENT_TIMESTAMP, order_count=order_count+1,
               updated_at=CURRENT_TIMESTAMP
           WHERE id=$3`,
          [phone?.trim() || '', address?.trim() || '', byName.rows[0].id]
        );
        return;
      }
    }
    // Insert new customer
    await query(
      `INSERT INTO customers (restaurant_id, name, phone, address)
       VALUES ($1,$2,$3,$4)`,
      [restaurantId, name?.trim() || '', phone?.trim() || null, address?.trim() || null]
    );
  } catch (err) {
    // Never crash order creation because of customer upsert failure
    console.error('Customer upsert failed (non-fatal):', err.message);
  }
}

// ── GET /api/customers/:restaurantId/suggest ─────────────────────────────────
// Returns up to 8 customers matching partial name or phone — for autocomplete
router.get('/:restaurantId/suggest', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) return res.json([]);

    const term = q.trim();
    const isNumeric = /^\d+/.test(term);

    let result;
    if (isNumeric) {
      result = await query(
        `SELECT id, name, phone, address
         FROM customers
         WHERE restaurant_id=$1 AND phone LIKE $2
         ORDER BY last_order_at DESC LIMIT 8`,
        [req.params.restaurantId, term + '%']
      );
    } else {
      result = await query(
        `SELECT id, name, phone, address
         FROM customers
         WHERE restaurant_id=$1 AND LOWER(name) LIKE $2
         ORDER BY last_order_at DESC LIMIT 8`,
        [req.params.restaurantId, term.toLowerCase() + '%']
      );
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/customers/:restaurantId ─────────────────────────────────────────
// List all customers with their order history
router.get('/:restaurantId', async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;
    const rid = req.params.restaurantId;

    let whereClause = 'WHERE c.restaurant_id=$1';
    const params = [rid];

    if (search && search.trim()) {
      const s = search.trim();
      params.push('%' + s.toLowerCase() + '%');
      const sp = params.length;
      params.push('%' + s.toLowerCase() + '%');
      const sp2 = params.length;
      whereClause += ` AND (LOWER(c.name) LIKE $${sp} OR c.phone LIKE $${sp2})`;
    }

    params.push(parseInt(limit));
    const lp = params.length;
    params.push(parseInt(offset));
    const op = params.length;

    const result = await query(
      `SELECT
         c.id, c.name, c.phone, c.address, c.order_count,
         c.last_order_at, c.created_at,
         COALESCE(SUM(o.total_amount), 0)::numeric(10,2) as total_spent,
         COALESCE(
           json_agg(
             DISTINCT jsonb_build_object(
               'name', oi.name,
               'count', oi.qty
             )
           ) FILTER (WHERE oi.name IS NOT NULL),
           '[]'::json
         ) as top_items
       FROM customers c
       LEFT JOIN orders o ON o.restaurant_id=c.restaurant_id
         AND (LOWER(o.customer_name)=LOWER(c.name) OR (c.phone IS NOT NULL AND o.customer_phone=c.phone))
         AND o.status='completed'
       LEFT JOIN LATERAL (
         SELECT oi2.name, COUNT(*) as qty
         FROM order_items oi2
         WHERE oi2.order_id = o.id
         GROUP BY oi2.name
         ORDER BY qty DESC
         LIMIT 3
       ) oi ON true
       ${whereClause}
       GROUP BY c.id
       ORDER BY c.last_order_at DESC
       LIMIT $${lp} OFFSET $${op}`,
      params
    );

    // Total count for pagination
    const countResult = await query(
      `SELECT COUNT(*) FROM customers c ${whereClause.replace(`LIMIT $${lp} OFFSET $${op}`, '')}`,
      params.slice(0, -2)
    );

    res.json({
      customers: result.rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/customers/:restaurantId/search-by-food ──────────────────────────
// Find customers who ordered a specific food item
router.get('/:restaurantId/search-by-food', async (req, res) => {
  try {
    const { item } = req.query;
    if (!item) return res.json([]);

    const result = await query(
      `SELECT DISTINCT
         c.id, c.name, c.phone, c.address, c.order_count, c.last_order_at,
         COUNT(DISTINCT o.id) as orders_with_item
       FROM customers c
       JOIN orders o ON o.restaurant_id=c.restaurant_id
         AND (LOWER(o.customer_name)=LOWER(c.name) OR (c.phone IS NOT NULL AND o.customer_phone=c.phone))
         AND o.status='completed'
       JOIN order_items oi ON oi.order_id=o.id AND LOWER(oi.name) LIKE $2
       WHERE c.restaurant_id=$1
       GROUP BY c.id
       ORDER BY orders_with_item DESC, c.last_order_at DESC
       LIMIT 50`,
      [req.params.restaurantId, '%' + item.toLowerCase() + '%']
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
