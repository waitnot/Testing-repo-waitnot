import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initDB } from './db.js';
import { ensureStartupData } from './startup-check.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import restaurantRoutes from './routes/restaurants.js';
import orderRoutes from './routes/orders.js';
import authRoutes from './routes/auth.js';
import analyticsRoutes from './routes/analytics.js';
import adminRoutes from './routes/admin.js';
import feedbackRoutes from './routes/feedback.js';
import printerSettingsRoutes from './routes/printerSettings.js';
import discountRoutes from './routes/discounts.js';
import staffRoutes from './routes/staff.js';
import deviceRoutes from './routes/devices.js';
import appVersionRoutes from './routes/appVersion.js';
import kitchenRoutes from './routes/kitchen.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  // Production domains
  'https://waitnot.in',
  'https://www.waitnot.in',
  'https://waitnot-restaurant1.onrender.com',
  'https://testing-repo-waitnot.onrender.com',
  // Capacitor / mobile
  'capacitor://localhost',
  'ionic://localhost',
  // Local dev
  'http://localhost:3000',
  'http://localhost:5001',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // curl / server-side
    if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) return callback(null, true);
    if (origin.startsWith('capacitor://') || origin.startsWith('ionic://')) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || origin.includes('vercel.app') || origin.includes('domainindiaapps.com')) return callback(null, true);
    console.log('❌ CORS blocked:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ── Health & status ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'OK', uptime: process.uptime(), timestamp: new Date().toISOString() }));
app.get('/api/status', (req, res) => res.json({ status: 'API is running', version: '1.0.0', timestamp: new Date().toISOString() }));

// ── Database init ─────────────────────────────────────────────────────────────
try {
  await initDB();
  await ensureStartupData();
  console.log('✅ Server initialization completed');
} catch (error) {
  console.error('❌ Server initialization failed:', error);
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/printer-settings', printerSettingsRoutes);
app.use('/api/discounts', discountRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/app-version', appVersionRoutes);
app.use('/api/kitchen', kitchenRoutes);

// ── Serve React build ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  // __dirname = /app/server (Procfile: web: node server/server.js)
  // client/dist = /app/client/dist  →  __dirname + '/../client/dist'
  const distPath = path.resolve(__dirname, '../client/dist');
  console.log('📁 __dirname:', __dirname);
  console.log('📁 distPath:', distPath);
  console.log('📁 index.html exists:', fs.existsSync(path.join(distPath, 'index.html')));

  // Hashed assets (/assets/*.js, /assets/*.css) — cache 1 year (content-addressed)
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
    etag: true,
  }));

  // Everything else (index.html, favicon, manifest) — no-cache so browser always gets fresh HTML
  app.use(express.static(distPath, {
    maxAge: 0,
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }));

  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('join-restaurant', (id) => { socket.join(`restaurant-${id}`); });
  socket.on('leave-restaurant', (id) => { socket.leave(`restaurant-${id}`); });
  socket.on('join-admin', () => { socket.join('admin-room'); });
  socket.on('disconnect', () => { console.log('Client disconnected:', socket.id); });
});
app.set('io', io);

// ── Start ─────────────────────────────────────────────────────────────────────
// Domain India App Platform requires: listen on PORT env var, bind to 0.0.0.0
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
