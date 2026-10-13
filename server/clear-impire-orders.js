import { query, initDatabase } from './database/connection.js';
import dotenv from 'dotenv';
dotenv.config();

async function clearImpireOrders() {
  await initDatabase();

  // Find Impire Kitchen restaurant
  const resResult = await query(
    `SELECT id, name FROM restaurants WHERE LOWER(name) LIKE '%impire%' LIMIT 1`
  );

  if (resResult.rows.length === 0) {
    console.log('❌ Impire Kitchen not found');
    process.exit(1);
  }

  const { id, name } = resResult.rows[0];
  console.log(`✅ Found: ${name} (${id})`);

  // Count orders
  const countResult = await query(
    `SELECT COUNT(*) as total FROM orders WHERE restaurant_id = $1`, [id]
  );
  console.log(`📊 Total orders: ${countResult.rows[0].total}`);

  // Delete order items first (FK constraint)
  const itemsResult = await query(
    `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE restaurant_id = $1)`, [id]
  );
  console.log(`🗑️  Deleted order items`);

  // Delete orders
  const ordersResult = await query(
    `DELETE FROM orders WHERE restaurant_id = $1 RETURNING id`, [id]
  );
  console.log(`✅ Deleted ${ordersResult.rows.length} orders for ${name}`);

  process.exit(0);
}

clearImpireOrders().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
