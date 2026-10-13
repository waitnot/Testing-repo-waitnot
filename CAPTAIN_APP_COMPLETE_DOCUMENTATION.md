# WaitNot Captain App (Staff) — Complete Technical Documentation

## Overview
The Captain App is the staff-facing Android/iOS app for taking orders, managing tables, and printing receipts. It provides a complete point-of-sale (POS) interface with real-time order management, Bluetooth/WiFi thermal printer support, and multi-device coordination.

---

## 1. SCREENS & VIEWS (activeView States)

### 1.1 **Tables Floor View** (`activeView='tables' && !selectedTable`)
- **Purpose**: Visual representation of all tables/rooms/order slots
- **Components**:
  - **Dine-In Tables**: Grid of 10+ table buttons (configurable via `restaurant.tables`)
  - **Rooms**: Optional room booking display (if `restaurant.rooms > 0`)
  - **Quick Orders**: Takeaway & Delivery buttons
- **Table Status**:
  - **Vacant** (green): No active orders
  - **Occupied** (red): Active orders exist
  - **Pulse Badge**: Animated red dot shows table has running orders
- **Data Displayed**: Table number, total amount for occupied tables
- **Actions**: Click table to open order entry screen

### 1.2 **Order Taking Screen** (`activeView='tables' && selectedTable`)
- **Left Panel (58% width on desktop)**:
  - Category sidebar (All, ⭐ Favourites, By Category)
  - Menu search bar (search by name or category)
  - Menu grid (items clickable to add to cart)
  - Each item shows: name, veg/non-veg indicator, favourite star, quantity controls
- **Right Panel (42% width, desktop only)**:
  - **Running Order Summary** (if existing orders exist):
    - Shows all items from active orders for this table/room
    - Quantity +/- buttons to adjust running items
    - Remove button (X) to delete items
  - **New Order Cart**:
    - Items being added now
    - Editable price per item
    - Toggle complimentary items
    - Quantity controls (-, qty, +)
- **Order Context Fields** (top bar):
  - Order type badge (Dine-In T3, Room, Takeaway, Delivery)
  - Customer name input
  - Phone number (for takeaway)
  - Delivery address (for delivery)

### 1.3 **Running Orders View** (`activeView='running'`)
- **Grouped Layout**:
  - **Tables Section**: Cards grouped by table number
  - **Rooms Section**: Cards grouped by room number
  - **Takeaway & Delivery**: Individual cards
- **Per-Order Card**:
  - Header: Table/Room label, order count, total amount
  - Items list with +/- quantity buttons
  - Remove item (X) button
  - Bottom Actions: Print KOT, Print Bill, Cancel, Clear Table
- **Real-time Updates**: Socket.IO pushes live order changes

### 1.4 **Order History View** (`activeView='history'`)
- **Search & Filter**:
  - Search by customer name, table, order ID
  - Filter by date/status
- **List Display**: Completed orders with date, items, total, payment method
- **Actions**: Reprint receipt, export data

### 1.5 **Sales Analytics View** (`activeView='sales'`)
- **Period Selector**: Today, This Week, This Month, All Time
- **Metrics**:
  - Total Revenue
  - Order Count
  - Cash vs Online split
  - Top 10 Items by quantity
  - Order type breakdown (dine-in, room, takeaway, delivery)
- **Charts**: Revenue trends, payment method pie chart

### 1.6 **Profile View** (`activeView='profile'`)
- **Staff Details**:
  - Profile picture (avatar with initials)
  - Name, email, waiter number/role
  - Phone, restaurant name
  - Role badge

### 1.7 **Settings View** (`activeView='settings'`)
- **Printer Configuration**:
  - Bluetooth printer selection (Kitchen & Bill printers)
  - WiFi printer IP/port setup
  - Auto-print toggles (KOT & Bill)
  - Test print buttons
- **Mobile Status**: Blue banner explaining multi-mobile Bluetooth setup
- **Device Connection State**: Shows paired printer connection status

---

## 2. API ENDPOINTS (GET/POST/PATCH/DELETE)

### 2.1 Authentication Routes (`/api/staff/*`)

**Login**
```
POST /api/staff/login
Body: { email, password }
Response: { token, staff: { id, name, email, role, waiter_number, restaurant_id } }
Storage: localStorage.setItem('staffToken', token); localStorage.setItem('staffData', JSON.stringify(staff))
Fallback: secureStorage.setItem('staffToken', token) — Android SecureStorage when cache cleared
```

**Logout**
```
POST /api/staff/logout
Headers: Authorization: Bearer {token}
Response: { message }
Action: Clears session, removes token from localStorage & secureStorage
```

**Staff List (Restaurant Owner)**
```
GET /api/staff/restaurant/:restaurantId
Response: Array of staff objects with role details
```

**Create Staff**
```
POST /api/staff
Body: { restaurantId, name, email, phone, password, role }
Response: Created staff object with waiter_number auto-generated (W01, W02, etc.)
```

### 2.2 Order Management Routes (`/api/orders/*`)

**Create Order**
```
POST /api/orders
Body: {
  restaurantId,
  tableNumber (if dine-in),
  roomNumber (if room),
  items: [{ menuItemId, name, price, quantity }],
  totalAmount,
  orderType: 'dine-in' | 'room' | 'takeaway' | 'delivery',
  customerName,
  customerPhone (delivery),
  deliveryAddress (delivery),
  packagingCharge (takeaway),
  deliveryCharge (delivery),
  source: 'staff' | 'qr',
  status: 'pending',
  paymentStatus: 'pending',
  paymentMethod: 'cash'
}
Response: Created order { _id, ...allFields }
Socket Emit: 'new-order' broadcast, 'print-kot' to print-server
Rate Limit: 1 order per 60s per table/room per IP (QR orders only)
```

**Get Active Orders by Restaurant**
```
GET /api/orders/restaurant/:restaurantId?status=active
Response: Array of all active orders
Polling: Every 15 seconds (catches missed socket events)
```

**Get Completed Orders**
```
GET /api/orders/restaurant/:restaurantId?status=completed
Response: Array of completed orders (for history & analytics)
```

**Update Order Status**
```
PATCH /api/orders/:id/status
Body: { status: 'pending' | 'preparing' | 'ready' | 'completed' }
Response: Updated order
Socket Emit: 'order-updated' broadcast
```

**Update Order Items**
```
PATCH /api/orders/:id/items
Body: { items: [...], totalAmount }
Response: Updated order
Action: Used when staff modifies quantity/removes items from running order
Socket Emit: 'order-updated'
```

**Update Payment**
```
PATCH /api/orders/:id/payment
Body: { paymentMethod: 'cash' | 'online' | 'upi', paymentSubType?, utrNumber? }
Response: Updated order with paymentStatus: 'paid'
```

**Batch Update Orders**
```
POST /api/orders/batch-update
Body: { orderIds: [...], status?, paymentMethod?, paymentSubType?, utrNumber?, paymentStatus? }
Response: { success: true, count: X }
Socket Emit: 'orders-updated' with { orderIds, updateData }
Action: Used for clearing multiple orders at once (table merge)
```

**Merge & Complete Orders**
```
POST /api/orders/merge-and-complete
Body: {
  orderIds: [...],
  paymentMethod,
  paymentSubType?,
  utrNumber?,
  restaurantId,
  tableNumber,
  roomNumber,
  orderType,
  customerName
}
Response: { success: true, merged: true, order: { merged order object } }
Transaction: Single DB transaction combines items, deletes originals, creates new 'completed' order
Socket Emit: 'orders-merged', 'print-bill' to print-server
```

**Delete Single Order**
```
DELETE /api/orders/:id
Response: { success: true, orderId }
Socket Emit: 'order-deleted' broadcast
Action: Cancel entire order (removes all items)
```

### 2.3 Restaurant Data

**Get Restaurant Details**
```
GET /api/restaurants/:restaurantId
Response: { 
  _id, 
  name, 
  menu: [{ _id, name, category, price, isVeg, available }],
  tables: 10,
  rooms: 4,
  features: { roomNames: { 1: 'Conference', 2: 'VIP', ... } }
}
Cache: localStorage.setItem(`restaurant_cache_${restaurantId}`, JSON.stringify(data))
Fallback: Show cached data instantly while refetching
```

### 2.4 FCM & Notifications

**Register FCM Token**
```
POST /api/devices/register-direct
Body: { fcmToken, restaurantId, platform: 'android' | 'ios' }
Purpose: Enable push notifications when app is closed
Called: Once on app startup (in registerFcmToken function)
```

---

## 3. DATA MODELS

### 3.1 Order Object
```javascript
{
  _id: ObjectId,
  restaurantId: ObjectId,
  orderNumber: Integer,
  
  // Location/Slot Info
  tableNumber: Integer | null,        // Dine-in table number
  roomNumber: Integer | null,         // Room booking number
  orderType: 'dine-in' | 'room' | 'takeaway' | 'delivery',
  
  // Customer Info
  customerName: String,
  customerPhone: String | null,
  deliveryAddress: String | null,
  
  // Items
  items: [{
    _id: ObjectId,
    menuItemId: ObjectId,
    name: String,
    price: Number,
    quantity: Integer,
    complimentary: Boolean | undefined
  }],
  
  // Charges
  totalAmount: Number,
  packagingCharge: Number | undefined,  // Takeaway only
  deliveryCharge: Number | undefined,   // Delivery only
  
  // Status
  status: 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled',
  paymentStatus: 'pending' | 'paid',
  paymentMethod: 'cash' | 'online' | 'upi' | 'card' | null,
  paymentSubType: String | null,        // e.g. 'GooglePay', 'Paytm'
  utrNumber: String | null,             // UTR for online transfers
  
  // Source & Metadata
  source: 'staff' | 'qr' | 'web',
  specialInstructions: String | null,
  createdAt: Date,
  updatedAt: Date
}
```

### 3.2 Menu Item Object
```javascript
{
  _id: ObjectId,
  restaurantId: ObjectId,
  name: String,
  category: String,
  price: Number,
  description: String | null,
  image: URL | null,
  isVeg: Boolean,
  available: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### 3.3 Restaurant Object
```javascript
{
  _id: ObjectId,
  name: String,
  email: String,
  phone: String,
  address: String,
  tables: Integer,              // Number of dine-in tables
  rooms: Integer,               // Number of room slots
  logo: URL | null,
  menu: [MenuItem],
  features: {
    roomNames: { 1: 'Name', 2: 'Name', ... },
    enableQROrdering: Boolean,
    enableDelivery: Boolean,
    tax: Number
  },
  createdAt: Date,
  updatedAt: Date
}
```

### 3.4 Staff Object
```javascript
{
  _id: ObjectId,
  restaurantId: ObjectId,
  name: String,
  email: String,
  phone: String,
  password: String,             // bcrypt hashed
  role: 'manager' | 'waiter' | 'kitchen',
  waiter_number: String,        // e.g. 'W01' for waiters
  permissions: {
    orders: { view, edit, delete },
    menu: { view, edit, delete },
    staff: { view, edit, delete },
    analytics: { view },
    settings: { view, edit }
  },
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

---

## 4. SOCKET.IO EVENTS

### 4.1 Emitted BY Client (Staff App)

**Join Restaurant Room**
```javascript
socket.emit('join-restaurant', restaurantId)
// Joins private room: restaurant-{restaurantId}
// Listens to all orders for this restaurant
```

**Leave Restaurant Room**
```javascript
socket.emit('leave-restaurant', restaurantId)
// Disconnects from room when logging out
```

### 4.2 Received BY Client (Listened)

**New Order**
```javascript
socket.on('new-order', (order) => {
  // Triggered when ANY new order created (QR or staff)
  // Shows notification, plays sound
  // Adds to local state immediately
  playOrderSound();
  showNewOrderNotification(order);
  setOrders(prev => [order, ...prev]);
})
```

**Order Updated**
```javascript
socket.on('order-updated', (order) => {
  // Single order status/items changed
  // If completed/cancelled: remove from state
  // Otherwise: replace in state
  if (order.status === 'completed' || order.status === 'cancelled') {
    setOrders(prev => prev.filter(x => x._id !== order._id));
  } else {
    setOrders(prev => [...prev mapping updated order...]);
  }
})
```

**Batch Orders Updated**
```javascript
socket.on('orders-updated', ({ orderIds, updateData }) => {
  // Multiple orders changed at once
  // updateData: { status?, paymentMethod?, paymentStatus? }
  // Updates all orderIds with new data
})
```

**Order Deleted**
```javascript
socket.on('order-deleted', ({ orderId }) => {
  // Single order removed entirely
  setOrders(prev => prev.filter(o => o._id !== orderId));
})
```

**Print KOT (Auto-Print)**
```javascript
socket.on('print-kot', ({ order }) => {
  // Triggered by server when order created
  // If autoPrintKitchenBill enabled: automatically prints KOT
  // Uses smartPrint → Bluetooth or WiFi printer
})
```

**Print Bill (Auto-Print)**
```javascript
socket.on('print-bill', ({ order, orders }) => {
  // Triggered by server when table cleared/bill generated
  // If autoPrintFinalBill enabled: automatically prints bill
  // Uses smartPrint with merged items from all orders
})
```

**Connection Established**
```javascript
socket.on('connect', () => {
  // Socket reconnected (after disconnect)
  socket.emit('join-restaurant', restaurantId);
  fetchOrders(restaurantId);  // Refresh to catch any missed updates
})
```

**Disconnected**
```javascript
socket.on('disconnect', () => {
  // Network lost, polling will keep data fresh
  console.log('Polling will handle updates...');
})
```

---

## 5. BLUETOOTH PRINTING FLOW

### 5.1 Print Architecture

**Priority Order**:
1. **Electron Desktop App** → Native silent print via `window.electronAPI.printKOT/printBill`
2. **Android Native** → EscPos plugin (Bluetooth thermal printer via hex commands)
3. **iOS Native** → WiFi TCP fallback (BLE Bluetooth not supported in web context)
4. **QZ Tray** (Desktop browsers) → Windows/Mac printer queue
5. **Browser Fallback** → Print dialog popup or hidden iframe

### 5.2 Bluetooth Connection Lifecycle

**Initial Setup**:
```
Staff Settings → "Find Printers" button
  ↓
scanBluetoothDevices() [EscPos plugin]
  ↓
getPairedBluetoothDevices() [already paired devices instant]
  ↓
User selects printer from list
  ↓
savePrinterSettings() to localStorage[printer_settings_{restaurantId}]
  ↓
autoReconnectPrinter() [runs on app startup]
```

**Auto-Reconnect on Startup**:
```javascript
autoReconnectPrinter(settings) {
  // Runs 2 seconds after StaffDashboard mounts
  for (const address of [btKitchenPrinter, btBillPrinter]) {
    connectBluetoothPrinter(address);  // Silent, no user interaction
    setConnectedPrinters({...previous, [address]: true});
  }
}
```

**Connection State Tracking**:
```
Bluetooth Listener: addBluetoothConnectionListener(({ address, state }) => {...})
  ↓
setConnectedPrinters({...prev, [address]: state === 'connected'})
  ↓
UI shows green dot when connected, gray when disconnected
```

### 5.3 ESC/POS Byte Protocol

**Thermal Printer Commands** (80mm thermal paper):
```
[INIT]       → 0x1B 0x40          Reset printer
[BOLD_ON]    → 0x1B 0x45 0x01     Bold text
[CENTER]     → 0x1B 0x61 0x01     Center align
[DOUBLE]     → 0x1B 0x21 0x30     Double height/width
[CUT]        → 0x1D 0x56 0x42     Full cut
[LF]         → 0x0A               Line feed
```

**KOT Ticket Structure**:
```
[INIT][CENTER][DOUBLE][BOLD]
RESTAURANT NAME (16 chars max)
[DOUBLE_OFF]
KITCHEN ORDER TICKET
order type
[BOLD_OFF]
============================== (32 chars)
[LEFT]
SLOT: TABLE 3
DATE: DD/MM/YYYY
TIME: HH:MM
REF: ORDER_ID
NAME: Customer Name
ADDR: Delivery Address
============================
[CENTER][BOLD]
── ITEMS TO PREPARE ──
[BOLD_OFF]
==============================
[LEFT]
ITEM_NAME                x QUANTITY
ITEM_NAME                x QUANTITY
==============================
[SPECIAL_INSTRUCTIONS if any]
[CENTER][BOLD]
─── PREPARE WITH CARE ───
[BOLD_OFF]
[LINEFEED × 1]
[CUT]
```

**Bill Ticket Structure**:
```
[INIT][CENTER][DOUBLE][BOLD]
RESTAURANT NAME
[DOUBLE_OFF]
DINE-IN RECEIPT | DELIVERY RECEIPT | TAKEAWAY RECEIPT
[BOLD_OFF]
==============================
[LEFT]
SLOT: TABLE 3
DATE: DD/MM/YYYY
TIME: HH:MM
NAME: Customer Name
PAYMENT: CASH
==============================
[TABLE HEADER]
ITEM        QTY   RATE        AMT
[ITEMS with qty × price]
==============================
[SUBTOTAL]
PACKAGING: ₹50
DELIVERY: ₹100
[BOLD][DOUBLE]
TOTAL: ₹5000
[DOUBLE_OFF][BOLD_OFF]
==============================
[CENTER][BOLD]
THANK YOU! VISIT AGAIN
★ ★ ★ ★ ★
[LINEFEED × 1]
[CUT]
```

### 5.4 Print Method Selection (smartPrint function)

```javascript
async function smartPrint(html, type='bill', orderData=null) {
  // 1. Electron silent print
  if (window.electronAPI?.printKOT && type==='kitchen') {
    return electronPrintKOT(order, restaurantName); // silent
  }
  
  // 2. Android/iOS native (Bluetooth ESC/POS)
  if (window.Capacitor?.isNativePlatform?.()) {
    const btAddress = type==='kitchen' ? btKitchenPrinter : btBillPrinter;
    const byteArr = buildKOTBytes(...) or buildBillBytes(...);
    
    if (btAddress) {
      const res = await escPosPrint(btAddress, byteArr);  // Hex via EscPos plugin
      if (res.success) return { method: 'escpos-bt' };
    }
    
    // WiFi fallback for iOS
    if (wifiHost) {
      const res = await wifiTcpPrint(wifiHost, wifiPort, byteArr);
      if (res.success) return { method: 'wifi-tcp' };
    }
  }
  
  // 3. QZ Tray (desktop browsers)
  if (settings.useQZTray && printerName) {
    await qzPrintHTML(html, printerName);
    return { method: 'qz' };
  }
  
  // 4. Browser fallback
  browserPrint(html);  // Popup or iframe
  return { method: 'browser' };
}
```

### 5.5 Hex Transmission to Android EscPos Plugin

```javascript
async function escPosPrint(address, byteArr) {
  const plugin = await getPlugin(); // EscPos Capacitor plugin
  const hex = toHex(byteArr);       // Convert [0x1B, 0x40, ...] → 'B1 40 ...'
  
  // Timeout 15 seconds (includes BT connection retry)
  await Promise.race([
    plugin.printHex({ address, hex }),
    new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 15000))
  ]);
  
  return { success: true };
}
```

---

## 6. PRINT TEMPLATES

### 6.1 KOT HTML Template (`buildKOTHTML`)

**File**: `client/src/utils/printTemplates.js`

**Parameters**:
```javascript
{
  restaurantName: String,
  slotLabel: String,              // "TABLE 3" | "ROOM 5" | "TAKEAWAY"
  orderId: String,
  orderType: String,
  customerName?: String,
  deliveryAddress?: String,
  specialInstructions?: String,
  items: [{name, quantity}],
  width?: '80mm' | '58mm'         // Thermal paper width
}
```

**Generated HTML**:
- Page size: 80mm × auto (thermal roll)
- Font: Courier New monospace
- Layout: Centered header, left-aligned items, dashed borders
- Output: String (can be printed via browser or sent as bytes to thermal printer)

### 6.2 Bill HTML Template (`buildBillHTML`)

**Parameters**:
```javascript
{
  restaurantName: String,
  slotLabel: String,
  orderType: String,
  customerName?: String,
  customerPhone?: String,
  deliveryAddress?: String,
  items: [{name, quantity, price, complimentary?}],
  packagingCharge?: Number,
  deliveryCharge?: Number,
  extraCharge?: Number,
  extraChargeLabel?: String,
  paymentMethod?: String,
  width?: '80mm' | '58mm'
}
```

**Generated HTML**:
- Full bill with all charges broken down
- Table layout for items (QTY × RATE = AMOUNT)
- Complimentary items marked with ★COMP
- Footer with thank you message
- Output: String (can be printed via browser or sent as bytes)

### 6.3 HTML-to-Bytes Conversion

**Scenario 1: Browser Print**
- HTML string passed to browser print dialog
- Browser renders and prints

**Scenario 2: Bluetooth ESC/POS Print**
- HTML parsed to plain text (extract `.innerText`)
- Text converted character-by-character to ASCII bytes
- Prepended with ESC/POS control commands (INIT, CENTER, BOLD, etc.)
- Sent as hex string to EscPos plugin

**Scenario 3: Electron Silent Print**
- HTML string passed to electronAPI.silentPrint
- Electron renders in offscreen window
- Sends to printer queue silently

---

## 7. AUTHENTICATION FLOW

### 7.1 Login Flow

**StaffLogin Page** (`/staff-login`):
```
1. User enters email + password
2. POST /api/staff/login
3. Server validates credentials, returns JWT token + staff object
4. Client stores:
   - localStorage.setItem('staffToken', token)
   - localStorage.setItem('staffData', JSON.stringify(staff))
   - secureStorage.setItem('staffToken', token)  [Android]
   - secureStorage.setItem('staffData', JSON.stringify(staff))  [Android]
5. Redirect to /staff-dashboard
6. axios.defaults.headers.Authorization = `Bearer ${token}`
```

### 7.2 Session Persistence

**On App Load** (`StaffDashboard useEffect`):
```
1. Check localStorage for staffToken & staffData
2. If missing but on Android, check secureStorage (recovered from cache clear)
3. If neither exists, redirect to /staff-login
4. Set axios Authorization header with token
5. Validate token with backend (implicit via protected API calls)
```

### 7.3 Token Management

**Token Format**: JWT signed with `process.env.JWT_SECRET`
```
{
  staffId: ObjectId,
  restaurantId: ObjectId,
  expiresIn: '30d'
}
```

**Expiry Handling**:
```
GET/POST to protected endpoint returns 401
→ interceptor catches 401
→ removes localStorage tokens
→ redirects to /staff-login
```

### 7.4 SecureStorage Integration

**Android Only** (iOS not supported in web context):
```javascript
// On login
await secureSet('staffToken', token);
await secureSet('staffData', JSON.stringify(staff));

// On logout
await secureRemove('staffToken');
await secureRemove('staffData');

// Recovery after cache clear
const savedToken = await secureGet('staffToken');
if (savedToken) localStorage.setItem('staffToken', savedToken);
```

**Purpose**: Survive app cache clear (system storage not affected)

### 7.5 Logout Flow

```
Click Logout button
  ↓
POST /api/staff/logout (with bearer token)
  ↓
Server removes session from DB
  ↓
Client clears localStorage & secureStorage
  ↓
socket.disconnect()
  ↓
Redirect to /staff-login
```

---

## 8. STATE VARIABLES & PURPOSE

### 8.1 Core State

| Variable | Type | Purpose |
|----------|------|---------|
| `staff` | Object | Logged-in staff member details (name, role, waiter_number) |
| `restaurant` | Object | Restaurant config (name, menu, tables, rooms, features) |
| `orders` | Array | All active orders for this restaurant (real-time via socket) |
| `loading` | Boolean | Initial data load spinner |
| `activeView` | String | Current screen: 'tables', 'running', 'history', 'sales', 'profile', 'settings' |
| `socket` | Object | Socket.IO connection instance |

### 8.2 Order Taking State

| Variable | Type | Purpose |
|----------|------|---------|
| `selectedTable` | Object | Current table/room being worked on: `{num, label}` |
| `orderCart` | Array | Items pending placement (before POST) |
| `menuSearch` | String | Menu search text input |
| `selectedCategory` | String | Active menu category filter |
| `orderContext` | Object | Context for current order (customer name, phone, delivery addr, charges) |
| `orderPlacing` | Boolean | Disable "Place Order" button while submitting |
| `favourites` | Array | Staff's favorited menu item IDs (localStorage) |

### 8.3 Running Orders State

| Variable | Type | Purpose |
|----------|------|---------|
| `editOrderModal` | Object | Modal for editing running order items |
| `editingPriceId` | String | Item ID currently being edited price |
| `extraCharge` | Object | Misc charge added to order (extra service fee) |

### 8.4 Modal & UI State

| Variable | Type | Purpose |
|----------|------|---------|
| `confirmModal` | Object | Confirmation dialog (message, onConfirm callback) |
| `clearTablePayModal` | Object | Payment entry dialog when clearing table |
| `onlinePayStep` | Boolean | Toggle between payment method and UTR entry |
| `onlinePayType` | String | 'upi' or 'card' |
| `utrNumber` | String | UTR/reference number for online payment |
| `toast` | Object | Temporary notification {msg, type} |

### 8.5 Printer State

| Variable | Type | Purpose |
|----------|------|---------|
| `printerSettings` | Object | Saved config: `{btKitchenPrinter, btBillPrinter, wifiPrinterIp, wifiPrinterPort, autoPrintKitchenBill, autoPrintFinalBill}` |
| `btPrinters` | Array | Scanned Bluetooth devices `[{name, address, rssi}]` |
| `isMobile` | Boolean | Is Capacitor app (native mobile) |
| `savingSettings` | Boolean | Disable save button while saving |
| `btTesting` | String | Address of printer being tested (for test button state) |
| `btScanStatus` | String | 'scanning', 'done', 'error' |
| `connectedPrinters` | Object | Map of address → connected boolean |

### 8.6 History & Analytics State

| Variable | Type | Purpose |
|----------|------|---------|
| `historyOrders` | Array | Completed orders list |
| `historyLoading` | Boolean | Loading spinner for history |
| `historySearch` | String | Search filter for history |
| `salesData` | Object | Aggregated sales metrics |
| `salesLoading` | Boolean | Loading spinner for sales |
| `salesPeriod` | String | 'today', 'week', 'month', 'all' |

---

## 9. ORDER LIFECYCLE

### 9.1 Status Flow

```
[pending] → [preparing] → [ready] → [completed]
                    ↓
                 [cancelled]
```

### 9.2 Detailed Lifecycle

**1. Order Created**
```
Staff clicks "Place Order" on cart
  ↓
POST /api/orders with items & totalAmount
  ↓
Server creates order with status='pending'
  ↓
Socket broadcasts 'new-order' to all staff devices
  ↓
App shows notification + plays sound
  ↓
Order appears in Running Orders view
```

**2. Status: Pending**
```
Kitchen hasn't started preparing yet
- KOT printed automatically (if autoPrintKitchenBill=true)
- Order visible in all staff phones (socket subscription)
- Can still modify items: add/remove/change qty
```

**3. Transition to Preparing**
```
Kitchen staff updates order status to 'preparing'
  ↓
Socket broadcasts 'order-updated' with new status
  ↓
UI updates order state (if kitchen app)
  ↓
Order color/icon changes to show "in progress"
```

**4. Transition to Ready**
```
Kitchen marks order as 'ready' when dishes complete
  ↓
Socket broadcasts 'order-updated'
  ↓
Staff app shows order as ready for pickup
```

**5. Transition to Completed**
```
Option A: Clear table with bill
  POST /api/orders/merge-and-complete with payment details
    ↓
    Creates single combined order with status='completed'
    ↓
    Deletes all individual orders for that table
    ↓
    Bill printed automatically (if autoPrintFinalBill=true)

Option B: Manual status update
  PATCH /api/orders/:id/status with status='completed'
```

**6. Completed Order**
```
No longer appears in Running Orders view
Moves to Order History
Included in sales analytics
Payment recorded (cash/online)
UTR number stored if online
```

### 9.3 Item-Level Changes

**While Pending/Preparing**:
```
Staff can edit items:
- Change quantity: updateRunningItemQty(orderId, itemName, delta)
- Remove item: cancelRunningItem(orderId, itemName)
- PATCH /api/orders/:id/items with new items list
  ↓
  Socket broadcasts updated items
  ↓
  Can retrigger KOT print if needed
```

**Payment Updates**:
```
While order active, can change payment method:
- PATCH /api/orders/:id/payment with paymentMethod
- Supports: cash, upi, card, online
- For online: store paymentSubType (GooglePay, Paytm, etc.) & utrNumber
```

---

## 10. REAL-TIME ORDER UPDATES FLOW

### 10.1 Multi-Source Updates

```
Sources of truth:
1. Socket.IO events (real-time, priority)
2. Polling every 15 seconds (fallback, catches missed events)
3. Manual refresh button (immediate)
```

### 10.2 Socket Event Processing

**Incoming 'order-updated'**:
```javascript
socket.on('order-updated', (o) => {
  if (o.status === 'completed' || o.status === 'cancelled') {
    // Remove from active state
    setOrders(prev => prev.filter(x => x._id !== o._id));
  } else if (already in state) {
    // Replace with updated data
    const idx = prev.findIndex(x => x._id === o._id);
    const n = [...prev];
    n[idx] = o;
    setOrders(n);
  } else {
    // New order, add to front
    setOrders(prev => [o, ...prev]);
  }
})
```

**Incoming 'orders-updated' (batch)**:
```javascript
socket.on('orders-updated', ({ orderIds, updateData }) => {
  if (updateData.status === 'completed') {
    // Remove all
    setOrders(prev => prev.filter(o => !orderIds.includes(o._id)));
  } else {
    // Update all with new data
    setOrders(prev => prev.map(o => {
      if (!orderIds.includes(o._id)) return o;
      return { ...o, ...updateData };  // status, paymentMethod, paymentStatus
    }));
  }
})
```

### 10.3 Polling Fallback

**Every 15 Seconds**:
```javascript
const refreshInterval = setInterval(async () => {
  const { data } = await axios.get(`/api/orders/restaurant/${restaurantId}?status=active`);
  
  // Find genuinely new orders not yet in state
  const newOnes = data.filter(o => !prev.find(x => x._id === o._id));
  if (newOnes.length > 0) {
    // Notify for each new order
    newOnes.forEach(o => {
      playOrderSound();
      showNewOrderNotification(o);
    });
    setOrders([...newOnes, ...prev]);
  }
  
  // Update existing orders (status may have changed)
  setOrders(data);
}, 15000);
```

### 10.4 Disconnect Handling

**When Socket Disconnects**:
```
socket.on('disconnect') triggers
  ↓
Polling interval continues (every 15s)
  ↓
When socket reconnects:
    socket.on('connect')
    socket.emit('join-restaurant', restaurantId)
    fetchOrders()  // Immediate refresh
```

### 10.5 Auto-Print via Socket

**When 'print-kot' received**:
```
server → socket.emit('print-kot', { order })
client receives:
  if (autoPrintKitchenBill && _isCapacitor) {
    smartPrint('', 'kitchen', { order, restaurantName })
      ↓
      Bluetooth ESC/POS print to kitchen printer
  }
```

**When 'print-bill' received**:
```
server → socket.emit('print-bill', { orders, order })
client receives:
  if (autoPrintFinalBill && _isCapacitor) {
    smartPrint('', 'bill', { orders, tableLabel, total })
      ↓
      Bluetooth ESC/POS print to bill printer
  }
```

---

## 11. KEY FUNCTIONS

### Core Order Operations
- `placeOrder()`: Create new order from cart
- `updateOrderStatus()`: Change order status
- `updateOrderItem()`: Modify items in running order
- `deleteOrderItem()`: Remove single item from order
- `cancelRunningItem()`: Remove item by name
- `updateRunningItemQty()`: Adjust quantity of running item
- `cancelOrders()`: Delete entire order
- `clearTable()`: Merge and complete table orders

### Printing
- `smartPrint(html, type, orderData)`: Route to correct printer
- `printKOT(order)`: Single order KOT
- `printKOTBatch(orders)`: Batch KOT combining items
- `printBill(tableOrders, label, total)`: Bill receipt
- `testBluetoothPrinter(address)`: Test print to verify connection
- `testWifiPrinter(host, port)`: Test WiFi printer

### Bluetooth Management
- `loadBluetoothPrinters()`: Scan and list devices
- `savePrinterSettings()`: Save config to localStorage
- `autoReconnectPrinter(settings)`: Connect on app startup
- `connectBluetoothPrinter(address)`: Establish BT connection
- `disconnectBluetoothPrinter(address)`: Disconnect printer

### Data Fetching
- `fetchRestaurantData(id)`: Get menu & config
- `fetchOrders(id)`: Get all active orders
- `fetchHistory()`: Get completed orders for history view
- `fetchSales(period)`: Calculate sales metrics for period

### UI Helpers
- `openTable(n)`: Start order for dine-in table
- `openRoom(n)`: Start order for room
- `openTakeaway()`: Create takeaway order
- `openDelivery()`: Create delivery order
- `addToCart(item)`: Add menu item to order
- `updateQty(id, qty)`: Adjust cart item quantity
- `toggleFavourite(itemId)`: Star/unstar menu item

---

## 12. CONFIGURATION & ENVIRONMENT

### API Endpoints

**Production**: `https://waitnot-restaurant.onrender.com`
**Local Dev**: `http://localhost:5001`
**Capacitor App**: Always uses production URL

**Detection**:
```javascript
const _isCapacitor = window.Capacitor?.isNativePlatform?.();
const _isLocalDev = !_isCapacitor && window.location.hostname === 'localhost';
const API = _isCapacitor ? PRODUCTION_URL : (_isLocalDev ? 'http://localhost:5001' : '');
```

### Storage

**localStorage** (browser):
- `staffToken`: JWT bearer token
- `staffData`: Stringified staff object
- `staff_favourites`: Array of favorite menu item IDs
- `restaurant_cache_{restaurantId}`: Cached menu/config
- `printer_settings_{restaurantId}`: Printer configuration
- `staff_selectedTable`: Persist table selection across refresh
- `staff_orderContext`: Persist order details across refresh

**secureStorage** (Android only):
- `staffToken`: Token in secure storage
- `staffData`: Staff data in secure storage
- (Survives cache clear)

**sessionStorage** (browser tab):
- `staff_selectedTable`: Session-specific table selection
- `staff_orderContext`: Session-specific order context
- `bt_connected_{address}`: Bluetooth connection state

---

## 13. ERROR HANDLING

### API Errors
- **401 Unauthorized**: Token expired → redirect to login
- **429 Too Many Requests**: Order rate limit → show retry countdown
- **400 Bad Request**: Validation error → show specific error message
- **500 Internal Server Error**: Server issue → show generic error, log details

### Network Errors
- **No Internet**: Polling fails, socket disconnects → UI shows graceful message
- **Slow Connection**: Orders appear delayed → polling catches up within 15s
- **Server Unreachable**: Use cached restaurant data → show spinner

### Printer Errors
- **BT Connection Timeout**: 15 second timeout → fallback to WiFi or browser
- **No Printer Configured**: Show setup required message
- **Printer Offline**: Show disconnected state, offer reconnect button

---

## 14. PERFORMANCE OPTIMIZATIONS

1. **Cached Restaurant Data**: Show instantly while fetching fresh data
2. **Batch Socket Events**: 'orders-updated' instead of individual 'order-updated' for bulk changes
3. **Debounced Search**: Menu search uses controlled input (no debouncing needed for small menu)
4. **Lazy Socket Listeners**: Listeners set up once on mount, torn down on unmount
5. **Smart Re-renders**: State updates only changed fields (not entire objects)
6. **Pagination**: History supports offset/limit (currently loads all)
7. **Memoization**: Categories and filteredMenu recalculated only when dependencies change

---

## 15. SECURITY CONSIDERATIONS

1. **Token Expiry**: 30 days, auto-refresh on 401
2. **CORS**: Production URL configured in axios
3. **XSS Protection**: No innerHTML usage, all text rendered safely via React
4. **CSRF**: Token-based (implicit via Bearer header)
5. **Secure Storage**: Android SecureStorage for tokens
6. **Rate Limiting**: Order creation limited to 1/min per table
7. **Role-Based Access**: Staff roles define API permissions (enforced server-side)

---

## File Reference Index

| File | Purpose |
|------|---------|
| `client/src/pages/StaffDashboard.jsx` | Main staff app UI and logic |
| `client/src/pages/StaffLogin.jsx` | Staff authentication page |
| `client/src/utils/qzPrint.js` | Bluetooth & printer abstraction layer |
| `client/src/utils/printTemplates.js` | KOT & Bill HTML template builders |
| `client/src/utils/orderNotification.js` | Native notifications & sound |
| `client/src/config/axios.js` | HTTP client config & interceptors |
| `server/routes/orders.js` | Order CRUD & socket events |
| `server/routes/staff.js` | Staff management & authentication |
| `server/routes/auth.js` | Login/logout/password change |

---

**Document Version**: 1.0
**Last Updated**: 2024
**Scope**: Complete Captain App (Staff) technical specification
