/*
   ======================================================
   🔧 Environment & Dependencies
   ====================================================== */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

/* ======================================================
   🔥 Firebase Admin Initialization
   ====================================================== */
let db = null;
let firebaseInitialized = false;
let firebaseInitError = null;

let firebaseConfig = {
  projectId: null,
  clientEmail: null,
  privateKey: null,
  databaseUrl: null
};

async function initializeFirebase() {
  const trimValue = (v) => v ? v.toString().trim() : v;
  const trimUrl = (v) => v ? v.toString().trim().replace(/\/+$/, '') : v;
  
  firebaseConfig.projectId = trimValue(process.env.FIREBASE_PROJECT_ID);
  firebaseConfig.clientEmail = trimValue(process.env.FIREBASE_CLIENT_EMAIL);
  firebaseConfig.privateKey = trimValue(process.env.FIREBASE_PRIVATE_KEY);
  firebaseConfig.databaseUrl = trimUrl(process.env.FIREBASE_DATABASE_URL);

  console.log('=== Firebase Config Debug ===');
  console.log('FIREBASE_PROJECT_ID:', firebaseConfig.projectId ? `SET (${firebaseConfig.projectId})` : 'NOT SET');
  console.log('FIREBASE_CLIENT_EMAIL:', firebaseConfig.clientEmail ? `SET` : 'NOT SET');
  console.log('FIREBASE_PRIVATE_KEY:', firebaseConfig.privateKey ? `SET (length: ${firebaseConfig.privateKey.length})` : 'NOT SET');
  console.log('FIREBASE_DATABASE_URL:', firebaseConfig.databaseUrl ? `SET (${firebaseConfig.databaseUrl})` : 'NOT SET');
  console.log('=============================');

  const missing = [firebaseConfig.projectId, firebaseConfig.clientEmail, firebaseConfig.privateKey, firebaseConfig.databaseUrl].filter(v => !v);
  
  if (missing.length > 0) {
    console.warn('⚠️ Missing Firebase environment variables');
    console.warn('Firebase features will be disabled');
    return false;
  }

  if (firebaseConfig.privateKey.includes('YOUR_PRIVATE_KEY_HERE') || 
      firebaseConfig.privateKey.includes('placeholder') ||
      firebaseConfig.privateKey.includes('GET_THIS_FROM') ||
      firebaseConfig.privateKey.length < 100) {
    console.warn('⚠️ Firebase private key appears to be invalid or placeholder');
    return false;
  }

  try {
    function parsePrivateKey(key) {
      if (!key) return '';
      let parsed = key.replace(/\\n/g, '\n');
      if (!parsed.includes('\n') && parsed.includes('-----BEGIN PRIVATE KEY-----')) {
        parsed = parsed
          .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
          .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
      }
      return parsed;
    }

    const parsedKey = parsePrivateKey(firebaseConfig.privateKey);
    
    const serviceAccount = {
      projectId: firebaseConfig.projectId,
      clientEmail: firebaseConfig.clientEmail,
      privateKey: parsedKey,
    };
    
    console.log('Initializing Firebase with projectId:', serviceAccount.projectId);
    console.log('Database URL:', firebaseConfig.databaseUrl);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: firebaseConfig.databaseUrl,
    });
    
    db = admin.database();
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialized successfully!');
    return true;
  } catch (error) {
    firebaseInitError = error.message;
    console.error('❌ Firebase initialization failed:', error.message);
    console.error('Error type:', error.constructor.name);
    return false;
  }
}

/* ======================================================
   🚀 Express App Setup
   ====================================================== */
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.options('*', cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/* ======================================================
   💳 M-Pesa Configuration
   ====================================================== */
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortCode: process.env.MPESA_SHORT_CODE,
  passKey: process.env.MPESA_PASS_KEY,
  environment: process.env.MPESA_SHORT_CODE === '174379' ? 'sandbox' : 'production',
};

const MPESA_BASE_URL =
  MPESA_CONFIG.environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

console.log('🔧 M-Pesa Config:', {
  env: MPESA_CONFIG.environment || 'Not set',
  hasKey: !!MPESA_CONFIG.consumerKey,
  hasSecret: !!MPESA_CONFIG.consumerSecret,
  hasShortCode: !!MPESA_CONFIG.shortCode,
  hasPassKey: !!MPESA_CONFIG.passKey,
  shortCode: MPESA_CONFIG.shortCode || 'Not set'
});

/* ======================================================
   📧 EmailJS Configuration
   ====================================================== */
const EMAILJS_CONFIG = {
  serviceId: process.env.EMAILJS_SERVICE_ID,
  templateId: process.env.EMAILJS_TEMPLATE_ID || 'order_confirmation',
  userId: process.env.EMAILJS_USER_ID,
  accessToken: process.env.EMAILJS_ACCESS_TOKEN,
};

console.log('📧 EmailJS Config:', {
  hasServiceId: !!EMAILJS_CONFIG.serviceId,
  hasUserId: !!EMAILJS_CONFIG.userId
});

/* ======================================================
   🔐 Get M-Pesa Access Token
   ====================================================== */
async function getMpesaAccessToken() {
  try {
    console.log('🔐 Getting M-Pesa access token...');
    
    if (!MPESA_CONFIG.consumerKey || !MPESA_CONFIG.consumerSecret) {
      throw new Error('M-Pesa consumer key or secret not configured');
    }
    
    const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');
    console.log('📡 Requesting token from:', `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`);

    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      { 
        headers: { 
          Authorization: `Basic ${auth}`, 
          'Content-Type': 'application/json' 
        }, 
        timeout: 15000,
      }
    );

    console.log('✅ M-Pesa token obtained');
    return response.data.access_token;
  } catch (error) {
    console.error('❌ M-Pesa auth failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Response:', JSON.stringify(error.response.data));
    }
    throw new Error(`M-Pesa auth failed: ${error.message}`);
  }
}

/* ======================================================
   🕒 Utilities
   ====================================================== */
function generateTimestamp() {
  const d = new Date();
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0');
}

function formatPhone(phone) {
  if (!phone) throw new Error('Phone number is required');
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  else if (cleaned.startsWith('+254')) cleaned = cleaned.slice(1);
  else if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
  if (cleaned.length !== 12) throw new Error(`Invalid phone number: ${phone}. Expected 12 digits, got ${cleaned.length}`);
  return cleaned;
}

/* ======================================================
   📧 EmailJS Functions
   ====================================================== */
async function sendOrderConfirmationEmail(order) {
  try {
    if (!order.customerInfo?.email || !EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.userId) return false;
    const orderIdShort = order.id.slice(-8).toUpperCase();
    const totalAmount = order.total.toLocaleString();
    const itemsListHTML = order.items.map(item => `<tr><td style="padding:10px;border-bottom:1px solid #e5e7eb"><strong>${item.name}</strong><br><small>${item.brand} • Qty: ${item.quantity}</small></td><td style="text-align:right;padding:10px;border-bottom:1px solid #e5e7eb">KSh ${(item.price * item.quantity).toLocaleString()}</td></tr>`).join('');
    const emailData = {
      to_email: order.customerInfo.email, customer_name: order.customerInfo.name, order_id: orderIdShort,
      items_list: itemsListHTML, total_amount: totalAmount, delivery_address: order.customerInfo.deliveryAddress,
      phone: order.customerInfo.phone, order_date: new Date(order.createdAt).toLocaleString(),
      receipt_number: order.mpesaData?.receiptNumber || '', amount_paid: (order.mpesaData?.amount || order.total).toLocaleString(),
      payment_time: new Date(order.updatedAt).toLocaleString(),
      order_link: `${process.env.FRONTEND_URL || 'https://shop.gadgets.crestrock.ltd'}/order-confirmation/${order.id}`,
      current_year: new Date().getFullYear().toString()
    };
    await axios.post('https://api.emailjs.com/api/v1.0/email/send',
      { service_id: EMAILJS_CONFIG.serviceId, template_id: EMAILJS_CONFIG.templateId, user_id: EMAILJS_CONFIG.userId, accessToken: EMAILJS_CONFIG.accessToken, template_params: emailData },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    console.log('✅ Email sent via EmailJS');
    return true;
  } catch (error) { console.error('❌ EmailJS error:', error.message); return false; }
}

async function sendAdminNotificationEmail(order) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail || !EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.userId) return false;
    const orderIdShort = order.id.slice(-8).toUpperCase();
    await axios.post('https://api.emailjs.com/api/v1.0/email/send',
      { service_id: EMAILJS_CONFIG.serviceId, template_id: process.env.EMAILJS_ADMIN_TEMPLATE_ID || EMAILJS_CONFIG.templateId, user_id: EMAILJS_CONFIG.userId, accessToken: EMAILJS_CONFIG.accessToken, template_params: { to_email: adminEmail, customer_name: order.customerInfo.name, order_id: orderIdShort, phone: order.customerInfo.phone, email: order.customerInfo.email || 'Not provided', total_amount: order.total.toLocaleString(), delivery_address: order.customerInfo.deliveryAddress, payment_method: order.paymentMethod, receipt_number: order.mpesaData?.receiptNumber || 'N/A', order_date: new Date(order.createdAt).toLocaleString(), current_year: new Date().getFullYear().toString() } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    return true;
  } catch (error) { console.error('❌ Admin email error:', error.message); return false; }
}

/* ======================================================
   📦 Firebase Helpers
   ====================================================== */
async function saveOrderToFirebase(orderData) {
  if (!db) throw new Error('Firebase not initialized');
  const ref = db.ref('orders').push();
  const order = { ...orderData, id: ref.key, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'pending' };
  await ref.set(order);
  return order;
}

async function updateOrderStatus(orderId, status, mpesaData = null) {
  if (!db) throw new Error('Firebase not initialized');
  const updates = { status, updatedAt: new Date().toISOString() };
  if (mpesaData) {
    const orderSnapshot = await db.ref(`orders/${orderId}`).once('value');
    const currentOrder = orderSnapshot.val();
    updates.mpesaData = { ...(currentOrder.mpesaData || {}), ...mpesaData };
  }
  await db.ref(`orders/${orderId}`).update(updates);
  return await getOrderById(orderId);
}

async function getOrderById(orderId) {
  if (!db) return null;
  const snapshot = await db.ref(`orders/${orderId}`).once('value');
  return snapshot.val();
}

async function createNotification(message, type, orderId = null, details = null) {
  if (!db) { console.log('📢 Notification (Firebase not init):', message); return; }
  try {
    const notificationRef = db.ref('notifications').push();
    await notificationRef.set({ id: notificationRef.key, message, type, orderId, details, read: false, time: new Date().toISOString() });
    console.log('📢 Notification created:', message);
  } catch (error) { console.error('❌ Error creating notification:', error.message); }
}

/* ======================================================
   📍 API Endpoints
   ====================================================== */
app.get('/api/debug', (req, res) => {
  res.json({
    firebase: { 
      projectId: firebaseConfig.projectId ? `SET (${firebaseConfig.projectId})` : 'NOT SET', 
      clientEmail: firebaseConfig.clientEmail ? 'SET' : 'NOT SET', 
      privateKey: firebaseConfig.privateKey ? `SET (length: ${firebaseConfig.privateKey.length})` : 'NOT SET', 
      databaseUrl: firebaseConfig.databaseUrl || 'NOT SET', 
      initialized: firebaseInitialized, 
      error: firebaseInitError 
    },
    mpesa: { 
      consumerKey: !!MPESA_CONFIG.consumerKey, 
      shortCode: MPESA_CONFIG.shortCode || 'NOT SET', 
      environment: MPESA_CONFIG.environment,
      hasConsumerSecret: !!MPESA_CONFIG.consumerSecret,
      hasPassKey: !!MPESA_CONFIG.passKey
    },
    emailjs: { serviceId: !!EMAILJS_CONFIG.serviceId, userId: !!EMAILJS_CONFIG.userId }
  });
});

// SMS Configuration - HostPinnacle
const ADMIN_PHONE = '254723555861';
const SMS_SENDER_ID = 'Crestrock';
const SMS_USER_ID = process.env.HOSTPINNACLE_SMS_USERID || 'obinnabrian';
const SMS_PASSWORD = process.env.HOSTPINNACLE_SMS_PASSWORD || 'Q7zrTux7';

// Log SMS config at startup
console.log('📱 SMS Config:');
console.log('   HOSTPINNACLE_SMS_USERID set:', !!SMS_USER_ID);
console.log('   HOSTPINNACLE_SMS_PASSWORD set:', !!SMS_PASSWORD);

// Send SMS using HostPinnacle API
async function sendHostPinnaclesSMS(phone, message) {
  if (!SMS_PASSWORD) {
    console.error('❌ SMS Password not configured');
    return 'SMS Password not configured';
  }
  
  console.log('📱 Sending SMS to:', phone);
  console.log('   Message:', message);
  console.log('   UserID:', SMS_USER_ID);
  
  // Use POST method with form data for HostPinnacle API
  const url = 'https://smsportal.hostpinnacle.co.ke/SMSApi/send';
  
  const formData = new URLSearchParams();
  formData.append('userid', SMS_USER_ID);
  formData.append('password', SMS_PASSWORD);
  formData.append('message', message);
  formData.append('sender', SMS_SENDER_ID);
  formData.append('mobile', phone);
  formData.append('output', 'text');
  
  console.log('   URL:', url);
  console.log('   FormData:', formData.toString());
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    });
    const result = await response.text();
    console.log('   Response:', result);
    return result;
  } catch (error) {
    console.log('   Error:', error.message);
    return 'Error: ' + error.message;
  }
}

app.post('/api/sms/send-order-confirmation', async (req, res) => {
  const { customerPhone, customerMessage, adminMessage } = req.body;
  try {
    const [customerResult, adminResult] = await Promise.allSettled([
      sendHostPinnaclesSMS(customerPhone, customerMessage),
      sendHostPinnaclesSMS(ADMIN_PHONE, adminMessage),
    ]);
    res.json({ success: true, customer: customerResult.status === 'fulfilled' ? customerResult.value : customerResult.reason?.message, admin: adminResult.status === 'fulfilled' ? adminResult.value : adminResult.reason?.message });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), service: 'Gadgets by Crestrock API', firebase: firebaseInitialized ? 'Connected' : 'Not initialized', mpesa: MPESA_CONFIG.consumerKey ? 'Configured' : 'Not configured', emailjs: EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.userId ? 'Configured' : 'Not configured', cors: 'enabled', endpoints: ['GET /api/health', 'GET /api/debug', 'POST /api/orders', 'GET /api/orders/:id', 'POST /api/mpesa/stk-push', 'POST /api/mpesa/callback', 'POST /api/test-email'] });
});

app.post('/api/orders', async (req, res) => {
  try {
    console.log('📦 Creating order request');
    const { items, total, customerInfo, paymentMethod } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, message: 'Order must contain at least one item' });
    if (!total || isNaN(total) || total <= 0) return res.status(400).json({ success: false, message: 'Invalid total amount' });
    if (!customerInfo || !customerInfo.name || !customerInfo.phone || !customerInfo.deliveryAddress) return res.status(400).json({ success: false, message: 'Missing customer information' });
    if (!paymentMethod) return res.status(400).json({ success: false, message: 'Payment method is required' });
    let formattedPhone;
    try { formattedPhone = formatPhone(customerInfo.phone); } catch (phoneError) { return res.status(400).json({ success: false, message: phoneError.message }); }
    const orderData = {
      items: items.map(item => ({ id: item.id || `item-${Date.now()}-${Math.random()}`, name: item.name || 'Unknown Product', price: parseFloat(item.price) || 0, quantity: parseInt(item.quantity) || 1, image: item.image || '', brand: item.brand || '' })),
      total: parseFloat(total), customerInfo: { ...customerInfo, phone: formattedPhone }, paymentMethod, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    let order;
    if (firebaseInitialized && db) {
      order = await saveOrderToFirebase(orderData);
      await createNotification(`🛒 New order #${order.id.slice(-8)} from ${customerInfo.name} (KSh ${total.toLocaleString()})`, 'info', order.id);
    } else {
      order = { ...orderData, id: `mock-${Date.now()}`, mock: true };
      console.log('⚠️ Firebase not initialized - order saved locally (mock):', order.id);
    }
    res.status(201).json({ success: true, order, message: 'Order created successfully' });
  } catch (error) { console.error('❌ Error creating order:', error.message); res.status(500).json({ success: false, message: 'Internal server error', error: error.message }); }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!firebaseInitialized || !db) return res.json({ success: true, order: { id, status: 'mock', message: 'Firebase not initialized - mock order' } });
    const order = await getOrderById(id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order });
  } catch (error) { console.error('❌ Error fetching order:', error.message); res.status(500).json({ success: false, message: 'Failed to fetch order' }); }
});

app.post('/api/mpesa/stk-push', async (req, res) => {
  try {
    console.log('📱 STK Push request received');
    const { phoneNumber, amount, orderId, accountReference, transactionDesc } = req.body;
    
    if (!phoneNumber) return res.status(400).json({ success: false, message: 'Phone number is required' });
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Valid amount is required' });
    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID is required' });

    // Validate M-Pesa configuration
    if (!MPESA_CONFIG.consumerKey || !MPESA_CONFIG.consumerSecret || !MPESA_CONFIG.shortCode || !MPESA_CONFIG.passKey) {
      console.error('❌ M-Pesa not properly configured');
      return res.status(500).json({ 
        success: false, 
        message: 'M-Pesa payment system is not properly configured. Please contact support.' 
      });
    }

    const order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const token = await getMpesaAccessToken();
    const phone = formatPhone(phoneNumber);
    const timestamp = generateTimestamp();
    const password = Buffer.from(MPESA_CONFIG.shortCode + MPESA_CONFIG.passKey + timestamp).toString('base64');

    // Validate and normalize callback URL
    function normalizeCallbackUrl(raw) {
      if (!raw) return null;
      try {
        const u = new URL(raw.toString().trim());
        if (u.protocol !== 'https:') return null;
        // ensure single trailing slash
        return u.href.replace(/\/+$/, '') + '/';
      } catch (e) {
        return null;
      }
    }

    const rawCallback = process.env.MPESA_CALLBACK_URL || `https://backend-gadgets--gadgets-83800.us-east5.hosted.app/api/mpesa/callback/`;
    const callbackUrl = normalizeCallbackUrl(rawCallback);
    if (!callbackUrl) {
      console.error('❌ Invalid MPESA_CALLBACK_URL configured:', rawCallback);
      return res.status(500).json({ success: false, message: 'Invalid MPESA_CALLBACK_URL configured on server. Must be a valid https URL.' });
    }

    const mpesaPayload = {
      BusinessShortCode: MPESA_CONFIG.shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: MPESA_CONFIG.shortCode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: accountReference || `ORDER-${orderId.slice(-8)}`,
      TransactionDesc: transactionDesc || 'Gadgets Purchase'
    };

    console.log('📡 Sending STK Push to:', MPESA_BASE_URL);
    console.log('   Payload:', JSON.stringify(mpesaPayload, null, 2));

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      mpesaPayload,
      { 
        headers: { 
          Authorization: `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        }, 
        timeout: 30000 
      }
    );

    console.log('✅ STK Push response:', JSON.stringify(response.data));

    if (response.data.ResponseCode === '0') {
      if (firebaseInitialized && db) {
        await updateOrderStatus(orderId, 'payment_pending', { 
          checkoutRequestId: response.data.CheckoutRequestID, 
          merchantRequestId: response.data.MerchantRequestID, 
          stkPushSentAt: new Date().toISOString(), 
          amount, 
          phoneNumber: phone 
        });
        await createNotification(`📱 STK Push sent to ${phone} for Order #${orderId.slice(-8)} (KSh ${amount})`, 'info', orderId);
      }
      res.json({ 
        success: true, 
        data: response.data, 
        message: response.data.CustomerMessage || 'STK Push initiated successfully' 
      });
    } else {
      console.error('❌ STK Push failed:', response.data);
      res.status(400).json({ 
        success: false, 
        message: response.data.ResponseDescription || 'STK Push failed',
        details: response.data
      });
    }
  } catch (error) {
    console.error('❌ STK Push error:', error.message);
    
    let errorMessage = 'Failed to initiate M-Pesa payment';
    let statusCode = 500;
    
    if (error.response) {
      console.error('   Safaricom API error:', error.response.status);
      console.error('   Response:', JSON.stringify(error.response.data));
      
      if (error.response.status === 400) {
        errorMessage = error.response.data?.errorMessage || error.response.data?.message || 'Invalid request to M-Pesa. Please check your phone number and try again.';
        statusCode = 400;
      } else if (error.response.status === 401) {
        errorMessage = 'M-Pesa authentication failed. Please contact support.';
      } else if (error.response.status === 503) {
        errorMessage = 'M-Pesa service is temporarily unavailable. Please try again in a few minutes.';
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'M-Pesa request timed out. Please try again.';
    }
    
    res.status(statusCode).json({ 
      success: false, 
      message: errorMessage,
      error: error.message 
    });
  }
});

app.get('/api/mpesa/callback', async (req, res) => {
  try {
    console.log('📞 M-Pesa Validation GET request received');
    console.log('   Query params:', req.query);
    res.status(200).json({ 
      ResultCode: 0, 
      ResultDesc: 'Success' 
    });
  } catch (error) {
    console.error('❌ M-Pesa validation error:', error.message);
    res.status(200).json({ 
      ResultCode: 0, 
      ResultDesc: 'Success' 
    });
  }
});

app.post('/api/mpesa/callback', async (req, res) => {
  try {
    console.log('📞 M-Pesa callback received');
    const stk = req.body?.Body?.stkCallback;
    if (!stk) return res.json({ ResultCode: 1, ResultDesc: 'No STK callback data' });
    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stk;
    if (!CheckoutRequestID) return res.json({ ResultCode: 1, ResultDesc: 'No CheckoutRequestID' });
    if (!firebaseInitialized || !db) { console.log('⚠️ Firebase not initialized - skipping callback processing'); return res.json({ ResultCode: 0, ResultDesc: 'Success (mock)' }); }
    const snapshot = await db.ref('orders').orderByChild('mpesaData/checkoutRequestId').equalTo(CheckoutRequestID).once('value');
    if (!snapshot.exists()) { console.log('❌ No order found for CheckoutRequestID:', CheckoutRequestID); return res.json({ ResultCode: 1, ResultDesc: 'Order not found' }); }
    const orders = snapshot.val();
    const orderId = Object.keys(orders)[0];
    const order = orders[orderId];
    if (ResultCode === 0) {
      let receiptNumber = 'Unknown', amount = 0, phoneNumber = 'Unknown';
      if (CallbackMetadata && CallbackMetadata.Item) {
        const meta = CallbackMetadata.Item;
        receiptNumber = meta.find(i => i.Name === 'MpesaReceiptNumber')?.Value || 'Unknown';
        amount = meta.find(i => i.Name === 'Amount')?.Value || 0;
        phoneNumber = meta.find(i => i.Name === 'PhoneNumber')?.Value || 'Unknown';
      }
      const updatedOrder = await updateOrderStatus(orderId, 'paid', { receiptNumber, amount, phoneNumber, completedAt: new Date().toISOString(), mpesaCallback: req.body });
      try { await sendOrderConfirmationEmail(updatedOrder); await sendAdminNotificationEmail(updatedOrder); } catch (emailError) { console.error('📧 Email sending failed:', emailError.message); }
      await createNotification(`💰 Payment of KSh ${amount} received for Order #${orderId.slice(-8)}`, 'success', orderId);
    } else {
      await updateOrderStatus(orderId, 'payment_failed', { reason: ResultDesc, failedAt: new Date().toISOString() });
      await createNotification(`❌ Payment failed for Order #${orderId.slice(-8)}: ${ResultDesc}`, 'error', orderId);
    }
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error) { console.error('❌ Callback error:', error.message); res.json({ ResultCode: 1, ResultDesc: 'Callback processing failed' }); }
});

app.post('/api/test-email', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });
    if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.userId) return res.status(500).json({ success: false, message: 'EmailJS not configured' });
    const response = await axios.post('https://api.emailjs.com/api/v1.0/email/send',
      { service_id: EMAILJS_CONFIG.serviceId, template_id: EMAILJS_CONFIG.templateId, user_id: EMAILJS_CONFIG.userId, accessToken: EMAILJS_CONFIG.accessToken, template_params: { to_email: email, customer_name: name || 'Test Customer', order_id: 'TEST-12345', items_list: '<tr><td>Test Product</td><td>KSh 1</td></tr>', total_amount: '1', delivery_address: 'Test Address', phone: '254712345678', order_date: new Date().toLocaleString(), receipt_number: 'TEST123', amount_paid: '1', payment_time: new Date().toLocaleString(), order_link: 'https://shop.gadgets.crestrock.ltd', current_year: new Date().getFullYear().toString() } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    res.json({ success: true, message: 'Test email sent', status: response.status });
  } catch (error) { console.error('❌ Test email error:', error.message); res.status(500).json({ success: false, message: 'Failed to send test email', error: error.message }); }
});

app.use('/api/*', (req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` }));
app.use((err, req, res, next) => { console.error('🔥 Error:', err.message); res.status(500).json({ success: false, message: 'Internal server error' }); });

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await initializeFirebase();
  console.log(`🔒 Firebase: ${firebaseInitialized ? 'Connected' : 'Not initialized'}`);
  console.log(`📧 EmailJS: ${EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.userId ? 'Configured' : 'Not configured'}`);
  console.log(`🔧 M-Pesa: ${MPESA_CONFIG.consumerKey ? 'Configured' : 'Not configured'}`);
});
