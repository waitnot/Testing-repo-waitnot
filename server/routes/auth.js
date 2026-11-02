import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { restaurantDB } from '../db.js';
import { JWT_SECRET, rateLimit } from '../middleware/auth.js';

const router = express.Router();

// Change password
router.post('/change-password', async (req, res) => {
  try {
    const { restaurantId, currentPassword, newPassword } = req.body;
    if (!restaurantId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }
    const restaurant = await restaurantDB.findById(restaurantId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, restaurant.password);
    if (!isCurrentPasswordValid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    const updatedRestaurant = await restaurantDB.update(restaurantId, { password: hashedNewPassword });
    if (updatedRestaurant) {
      res.json({ message: 'Password changed successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update password' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restaurant login
router.post('/login', rateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    const restaurant = await restaurantDB.findOne({ email });
    if (!restaurant) return res.status(401).json({ error: 'Invalid credentials' });
    const isValid = await bcrypt.compare(password, restaurant.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: restaurant._id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    const { password: _, ...restaurantData } = restaurant;
    res.json({ token, restaurant: restaurantData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Diagnostic: check password hash state
router.post('/debug-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const restaurant = await restaurantDB.findOne({ email });
    if (!restaurant) return res.json({ found: false, email });
    const isValid = await bcrypt.compare(password, restaurant.password);
    const isHashed = restaurant.password ? restaurant.password.startsWith('$2') : false;
    res.json({ found: true, name: restaurant.name, email: restaurant.email, isHashed, bcryptMatch: isValid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restaurant register — disabled, admin-only
router.post('/register', async (req, res) => {
  res.status(403).json({
    error: 'Public registration is disabled. Please contact an administrator.',
    adminLoginUrl: '/admin-login'
  });
});

export default router;
