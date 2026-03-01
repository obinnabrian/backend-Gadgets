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

async function initializeFirebase() {
  const requiredVars = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL', 
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_DATABASE_URL'
  ];

  // Debug: Log all env var presence
  console.log('=== Firebase Config Debug ===');
  console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? 'SET' : 'NOT SET');
  console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? 'SET' : 'NOT SET');
  console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'SET' : 'NOT SET', 
    process.env.FIREBASE_PRIVATE_KEY ? `(length: ${process.env.FIREBASE_PRIVATE_KEY.length})` : '');
  console.log('FIREBASE_DATABASE_URL:', process.env.FIREBASE_DATABASE_URL ? 'SET' : 'NOT SET');
  console.log('=============================');

  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.warn('⚠️ Missing Firebase environment variables:', missing);
    console.warn('Firebase features will be disabled');
    return false;
  }

  // Check if private key is a placeholder
  const keyValue = process.env.FIREBASE_PRIVATE_KEY;
  if (keyValue.includes('YOUR_PRIVATE_KEY_HERE') || 
      keyValue.includes('placeholder') ||
      keyValue.includes('GET_THIS_FROM') ||
      keyValue.length < 100) {
    console.warn('⚠️ Firebase private key appears to be invalid or placeholder');
    console.warn('Private key preview:', keyValue.substring(0, 100));
    return false;
  }

  try {
    // Robust private key parser
    function parsePrivateKey(key) {
      if (!key) return '';
      
      // Replace literal \n with actual newlines
      let parsed = key.replace(/\\n/g, '\n');
      
      // Handle if it comes as a single line with headers but no newlines
      if (!parsed.includes('\n') && parsed.includes('-----BEGIN PRIVATE KEY-----')) {
        parsed = parsed
          .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
          .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
      }
      
      return parsed;
    }

    const privateKey = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    
    // Debug: Check key format
    console.log('Private key format check:');
    console.log('- Starts with BEGIN:', privateKey.startsWith('-----BEGIN PRIVATE KEY-----'));
    console.log('- Ends with END:', privateKey.endsWith('-----END PRIVATE KEY-----\n') || privateKey.endsWith('-----END PRIVATE KEY-----'));
    console.log('- Contains newlines:', privateKey.includes('\n'));
    console.log('- Length:', privateKey.length);
    
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    };
    
    console.log('Initializing Firebase with:', {
      projectId: serviceAccount.projectId,
      clientEmail: serviceAccount.clientEmail,
      privateKeyLength: serviceAccount.privateKey.length
    });
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    
    db = admin.database();
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialized successfully!');
    return true;
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

/* ======================================================
   🚀 Express App Setup
   ====================================================== */
const app = express();
const PORT = process.env.PORT || 8080;

// CORS - allow all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.options('*', cors());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging
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
  hasUserId: !!EMAILJS_CONFIG.userId,
  hasTemplateId: !!EMAILJS_CONFIG.templateId,
  serviceId: EMAILJS_CONFIG.serviceId,
  templateId: EMAILJS_CONFIG.templateId,
  userId: EMAILJS_CONFIG.userId
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
    
    const auth = Buffer.from(
      `${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`
    ).toString('base64');

    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { 
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000,
      }
    );

    console.log('✅ M-Pesa token obtained');
    return response.data.access_token;
  } catch (error) {
    console.error('❌ M-Pesa auth failed:', error.message);
    throw new Error(`M-Pesa auth failed: ${error.message}`);
  }
}

/* ======================================================
   🕒 Utilities
   ====================================================== */
function generateTimestamp() {
  const d = new Date();
  return (
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0')
  );
}

function formatPhone(phone) {
  if (!phone) throw new Error('Phone number is required');
  
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  else if (cleaned.startsWith('+254')) cleaned = cleaned.slice(1);
  else if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;

  if (cleaned.length !== 12) {
    throw new Error(`Invalid phone number: ${phone}. Expected 12 digits, got ${cleaned.length}`);
  }
  return cleaned;
}

/* ======================================================
   📧 EmailJS Functions
   ====================================================== */
async function sendOrderConfirmationEmail(order) {
  try {
    if (!order.customerInfo?.email) {
      console.log('📧 No email provided, skipping');
      return false;
    }

    if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.userId) {
      console.log('📧 EmailJS not configured');
      return false;
    }

    const orderIdShort = order.id.slice(-8).toUpperCase();
    const totalAmount = order.total.toLocaleString();
    
    const itemsListHTML = order.items.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
          <strong>${item.name}</strong><br>
          <small>${item.brand} • Qty: ${item.quantity}</small>
        </td>
        <td style="text-align: right; padding: 10px; border-bottom: 1px solid #e5e7eb;">
          KSh ${(item.price * item.quantity).toLocaleString()}
        </td>
      </tr>
    `).join('');

    const emailData = {
      to_email: order.customerInfo.email,
      customer_name: order.customerInfo.name,
      order_id: orderIdShort,
      items_list: itemsListHTML,
      total_amount: totalAmount,
      delivery_address: order.customerInfo.deliveryAddress,
      phone: order.customerInfo.phone,
      order_date: new Date(order.createdAt).toLocaleString(),
      receipt_number: order.mpesaData?.receiptNumber || '',
      amount_paid: (order.mpesaData?.amount || order.total).toLocaleString(),
      payment_time: new Date(order.updatedAt).toLocaleString(),
      order_link: `${process.env.FRONTEND_URL || 'https://shop.gadgets.crestrock.ltd'}/order-confirmation/${order.id}`,
      current_year: new Date().getFullYear().toString(),
    };

    const response = await axios.post(
      'https://api.emailjs.com/api/v1.0/email/send',
      {
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.userId,
        accessToken: EMAILJS_CONFIG.accessToken,
        template_params: emailData,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );

    console.log('✅ Email sent via EmailJS');
    return true;
  } catch (error) {
    console.error('❌ EmailJS error:', error.message);
    return false;
  }
}

async function sendAdminNotificationEmail(order) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail || !EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.userId) {
      return false;
    }

    const orderIdShort = order.id.slice(-8).toUpperCase();
    const totalAmount = order.total.toLocaleString();

    const emailData = {
      to_email: adminEmail,
      customer_name: order.customerInfo.name,
      order_id: orderIdShort,
      phone: order.customerInfo.phone,
      email: order.customerInfo.email || 'Not provided',
      total_amount: totalAmount,
      delivery_address: order.customerInfo.deliveryAddress,
      payment_method: order.paymentMethod,
      receipt_number: order.mpesaData?.receiptNumber || 'N/A',
      order_date: new Date(order.createdAt).toLocaleString(),
      current_year: new Date().getFullYear().toString(),
    };

    await axios.post(
      'https://api.emailjs.com/api/v1.0/email/send',
      {
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: process.env.EMAILJS_ADMIN_TEMPLATE_ID || EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.userId,
        accessToken: EMAILJS_CONFIG.accessToken,
        template_params: emailData,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );

    return true;
  } catch (error) {
    console.error('❌ Admin email error:', error.message);
    return false;
  }
}

/* ======================================================
   📦 Firebase Helpers
   ====================================================== */
async function saveOrderToFirebase(orderData) {
  if (!db) throw new Error('Firebase not initialized');
  
  const ref = db.ref('orders').push();
  const order = {
    ...orderData,
    id: ref.key,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'pending',
  };
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
  if (!db) {
    console.log('📢 Notification (Firebase not init):', message);
    return;
  }
  
  try {
    const notificationRef = db.ref('notifications').push();
    const notification = {
      id: notificationRef.key,
      message,
      type,
      orderId,
      details,
      read: false,
      time: new Date().toISOString()
    };
    await notificationRef.set(notification);
    console.log('📢 Notification created:', message);
  } catch (error) {
    console.error('❌ Error creating notification:', error.message);
  }
}

/* ======================================================
   📍 API Endpoints
   ====================================================== */

// HostPinnacle SMS
const ADMIN_PHONE = '254723555861';
const SMS_SENDER_ID = 'Crestrock';

async function sendHostPinnaclesSMS(phone, message) {
  const apiKey = process.env.HOSTPINNACLE_SMS_API_KEY || '1ded5da8f455a25ef5566afd260a1158d8963892';
  const url = 'https://smsportal.hostpinnacle.co.ke/SMSApi/send/';
  const params = new URLSearchParams({
    apikey: apiKey,
    partnerID: '4725',
    message,
    Sender_ID: SMS_SENDER_ID,
    shortcode: SMS_SENDER_ID,
    mobile: phone,
  });
  const response = await fetch(`${url}?${params.toString()}`);
  return response.text();
}

app.post('/api/sms/send-order-confirmation', async (req, res) => {
  const { customerPhone, customerMessage, adminMessage } = req.body;
  try {
    const [customerResult, adminResult] = await Promise.allSettled([
      sendHostPinnaclesSMS(customerPhone, customerMessage),
      sendHostPinnaclesSMS(ADMIN_PHONE, adminMessage),
    ]);
    res.json({
      success: true,
      customer: customerResult.status === 'fulfilled' ? customerResult.value : customerResult.reason?.message,
      admin: adminResult.status === 'fulfilled' ? adminResult.value : adminResult.reason?.message,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Gadgets by Crestrock API',
    firebase: firebaseInitialized ? 'Connected' : 'Not initialized',
    mpesa: MPESA_CONFIG.consumerKey ? 'Configured' : 'Not configured',
    emailjs: EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.userId ? 'Configured' : 'Not configured',
    cors: 'enabled',
    endpoints: [
      'GET /api/health',
      'POST /api/orders',
      'GET /api/orders/:id',
      'POST /api/mpesa/stk-push',
      'POST /api/mpesa/callback',
      'POST /api/test-email'
    ]
  });
});

// Create Order
app.post('/api/orders', async (req, res) => {
  try {
    console.log('📦 Creating order request');
    
    const { items, total, customerInfo, paymentMethod } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must contain at least one item' });
    }
    
    if (!total || isNaN(total) || total <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid total amount' });
    }
    
    if (!customerInfo || !customerInfo.name || !customerInfo.phone || !customerInfo.deliveryAddress) {
      return res.status(400).json({ success: false, message: 'Missing customer information' });
    }

    if (!paymentMethod) {
      return res.status(400).json({ success: false, message: 'Payment method is required' });
    }

    // Format phone
    let formattedPhone;
    try {
      formattedPhone = formatPhone(customerInfo.phone);
    } catch (phoneError) {
      return res.status(400).json({ success: false, message: phoneError.message });
    }
    
    const orderData = {
      items: items.map(item => ({
        id: item.id || `item-${Date.now()}-${Math.random()}`,
        name: item.name || 'Unknown Product',
        price: parseFloat(item.price) || 0,
        quantity: parseInt(item.quantity) || 1,
        image: item.image || '',
        brand: item.brand || ''
      })),
      total: parseFloat(total),
      customerInfo: { ...customerInfo, phone: formattedPhone },
      paymentMethod,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save to Firebase if initialized
    let order;
    if (firebaseInitialized && db) {
      order = await saveOrderToFirebase(orderData);
      await createNotification(
        `🛒 New order #${order.id.slice(-8)} from ${customerInfo.name} (KSh ${total.toLocaleString()})`,
        'info', order.id
      );
    } else {
      // Generate a mock order ID for local testing without Firebase
      order = { ...orderData, id: `mock-${Date.now()}`, mock: true };
      console.log('⚠️ Firebase not initialized - order saved locally (mock):', order.id);
    }
    
    res.status(201).json({ success: true, order, message: 'Order created successfully' });
  } catch (error) {
    console.error('❌ Error creating order:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});

// Get Order
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!firebaseInitialized || !db) {
      return res.json({
        success: true,
        order: { id, status: 'mock', message: 'Firebase not initialized - mock order' }
      });
    }
    
    const order = await getOrderById(id);
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    res.json({ success: true, order });
  } catch (error) {
    console.error('❌ Error fetching order:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// STK Push
app.post('/api/mpesa/stk-push', async (req, res) => {
  try {
    console.log('📱 STK Push request received');
    
    const { phoneNumber, amount, orderId, accountReference, transactionDesc } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    // Verify order exists
    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const token = await getMpesaAccessToken();
    const phone = formatPhone(phoneNumber);
    const timestamp = generateTimestamp();
    const password = Buffer.from(
      MPESA_CONFIG.shortCode + MPESA_CONFIG.passKey + timestamp
    ).toString('base64');

    const mpesaPayload = {
      BusinessShortCode: MPESA_CONFIG.shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: MPESA_CONFIG.shortCode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL || `https://backend-gadgets--gadgets-83800.us-east5.hosted.app/api/mpesa/callback`,
      AccountReference: accountReference || `ORDER-${orderId.slice(-8)}`,
      TransactionDesc: transactionDesc || 'Gadgets Purchase',
    };

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      mpesaPayload,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    if (firebaseInitialized && db) {
      await updateOrderStatus(orderId, 'payment_pending', {
        checkoutRequestId: response.data.CheckoutRequestID,
        merchantRequestId: response.data.MerchantRequestID,
        stkPushSentAt: new Date().toISOString(),
        amount,
        phoneNumber: phone
      });
      
      await createNotification(
        `📱 STK Push sent to ${phone} for Order #${orderId.slice(-8)} (KSh ${amount})`,
        'info', orderId
      );
    }
    
    res.json({
      success: true,
      data: response.data,
      message: 'STK Push initiated successfully'
    });
  } catch (error) {
    console.error('❌ STK Push error:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to initiate STK Push' });
  }
});

// M-Pesa Callback
app.post('/api/mpesa/callback', async (req, res) => {
  try {
    console.log('📞 M-Pesa callback received');
    
    const stk = req.body?.Body?.stkCallback;
    if (!stk) {
      return res.json({ ResultCode: 1, ResultDesc: 'No STK callback data' });
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stk;
    
    if (!CheckoutRequestID) {
      return res.json({ ResultCode: 1, ResultDesc: 'No CheckoutRequestID' });
    }

    if (!firebaseInitialized || !db) {
      console.log('⚠️ Firebase not initialized - skipping callback processing');
      return res.json({ ResultCode: 0, ResultDesc: 'Success (mock)' });
    }

    const ordersRef = db.ref('orders');
    const snapshot = await ordersRef
      .orderByChild('mpesaData/checkoutRequestId')
      .equalTo(CheckoutRequestID)
      .once('value');

    if (!snapshot.exists()) {
      console.log('❌ No order found for CheckoutRequestID:', CheckoutRequestID);
      return res.json({ ResultCode: 1, ResultDesc: 'Order not found' });
    }

    const orders = snapshot.val();
    const orderId = Object.keys(orders)[0];
    const order = orders[orderId];

    if (ResultCode === 0) {
      let receiptNumber = 'Unknown';
      let amount = 0;
      let phoneNumber = 'Unknown';
      
      if (CallbackMetadata && CallbackMetadata.Item) {
        const meta = CallbackMetadata.Item;
        receiptNumber = meta.find(i => i.Name === 'MpesaReceiptNumber')?.Value || 'Unknown';
        amount = meta.find(i => i.Name === 'Amount')?.Value || 0;
        phoneNumber = meta.find(i => i.Name === 'PhoneNumber')?.Value || 'Unknown';
      }
      
      const updatedOrder = await updateOrderStatus(orderId, 'paid', {
        receiptNumber, amount, phoneNumber,
        completedAt: new Date().toISOString(),
        mpesaCallback: req.body
      });
      
      // Send emails
      try {
        await sendOrderConfirmationEmail(updatedOrder);
        await sendAdminNotificationEmail(updatedOrder);
      } catch (emailError) {
        console.error('📧 Email sending failed:', emailError.message);
      }
      
      await createNotification(
        `💰 Payment of KSh ${amount} received for Order #${orderId.slice(-8)}`,
        'success', orderId
      );
    } else {
      await updateOrderStatus(orderId, 'payment_failed', { 
        reason: ResultDesc,
        failedAt: new Date().toISOString()
      });
      
      await createNotification(
        `❌ Payment failed for Order #${orderId.slice(-8)}: ${ResultDesc}`,
        'error', orderId
      );
    }

    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error) {
    console.error('❌ Callback error:', error.message);
    res.json({ ResultCode: 1, ResultDesc: 'Callback processing failed' });
  }
});

// Test Email
app.post('/api/test-email', async (req, res) => {
  try {
    const { email, name } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email required' });
    }

    if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.userId) {
      return res.status(500).json({ success: false, message: 'EmailJS not configured' });
    }

    const testEmailData = {
      to_email: email,
      customer_name: name || 'Test Customer',
      order_id: 'TEST-12345',
      items_list: '<tr><td>Test Product</td><td>KSh 1</td></tr>',
      total_amount: '1',
      delivery_address: 'Test Address',
      phone: '254712345678',
      order_date: new Date().toLocaleString(),
      receipt_number: 'TEST123',
      amount_paid: '1',
      payment_time: new Date().toLocaleString(),
      order_link: 'https://shop.gadgets.crestrock.ltd',
      current_year: new Date().getFullYear().toString(),
    };

    const response = await axios.post(
      'https://api.emailjs.com/api/v1.0/email/send',
      {
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.userId,
        accessToken: EMAILJS_CONFIG.accessToken,
        template_params: testEmailData,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );

    res.json({ success: true, message: 'Test email sent', status: response.status });
  } catch (error) {
    console.error('❌ Test email error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to send test email', error: error.message });
  }
});

// 404 Handler
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('🔥 Error:', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Start Server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // Initialize Firebase
  await initializeFirebase();
  
  console.log(`🔒 Firebase: ${firebaseInitialized ? 'Connected' : 'Not initialized'}`);
  console.log(`📧 EmailJS: ${EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.userId ? 'Configured' : 'Not configured'}`);
  console.log(`🔧 M-Pesa: ${MPESA_CONFIG.consumerKey ? 'Configured' : 'Not configured'}`);
});
