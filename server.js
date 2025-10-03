// server.js
import express from 'express';
import { checkoutHandler, Webhooks } from '@dodopayments/express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Simple in-memory database (use a real DB in production)
const payments = new Map();

// File-based persistence for payment status
const PAYMENTS_FILE = path.join(__dirname, 'payments.json');

// Load existing payments from file
function loadPayments() {
  try {
    if (fs.existsSync(PAYMENTS_FILE)) {
      const data = fs.readFileSync(PAYMENTS_FILE, 'utf8');
      const paymentsData = JSON.parse(data);
      Object.entries(paymentsData).forEach(([key, value]) => {
        payments.set(key, value);
      });
    }
  } catch (err) {
    console.error('Error loading payments:', err);
  }
}

// Save payments to file
function savePayments() {
  try {
    const paymentsObj = Object.fromEntries(payments);
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(paymentsObj, null, 2));
  } catch (err) {
    console.error('Error saving payments:', err);
  }
}

// Initialize payments on startup
loadPayments();

// Static checkout route - handles the specific product you want to test
app.get('/api/checkout', checkoutHandler({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  returnUrl: process.env.DODO_PAYMENTS_RETURN_URL || 'http://localhost:3000/',
  environment: process.env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode',
  type: 'static'
}));

// Dynamic checkout route
app.post('/api/checkout', checkoutHandler({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  returnUrl: process.env.DODO_PAYMENTS_RETURN_URL || 'http://localhost:3000/',
  environment: process.env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode',
  type: 'dynamic'
}));

// Webhook handler - receives payment status updates
app.post('/api/webhook', Webhooks({
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
  onPayload: async (payload) => {
    console.log('Received webhook payload:', payload);
  },
  onPaymentSucceeded: async (payload) => {
    console.log('Payment succeeded:', payload);
    const paymentId = payload.payment_id;
    payments.set(paymentId, {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: payload
    });
    savePayments();
  },
  onPaymentFailed: async (payload) => {
    console.log('Payment failed:', payload);
    const paymentId = payload.payment_id;
    payments.set(paymentId, {
      status: 'failed',
      timestamp: new Date().toISOString(),
      data: payload
    });
    savePayments();
  },
  onPaymentProcessing: async (payload) => {
    console.log('Payment processing:', payload);
    const paymentId = payload.payment_id;
    payments.set(paymentId, {
      status: 'processing',
      timestamp: new Date().toISOString(),
      data: payload
    });
    savePayments();
  },
  onPaymentCancelled: async (payload) => {
    console.log('Payment cancelled:', payload);
    const paymentId = payload.payment_id;
    payments.set(paymentId, {
      status: 'cancelled',
      timestamp: new Date().toISOString(),
      data: payload
    });
    savePayments();
  }
}));

// API endpoint to save payment from URL parameters
app.post('/api/save-payment', (req, res) => {
  try {
    const { id, status, timestamp } = req.body;
    
    if (!id || !status) {
      return res.status(400).json({ error: 'Payment ID and status are required' });
    }

    payments.set(id, {
      status: status,
      timestamp: timestamp || new Date().toISOString(),
      data: req.body
    });
    
    savePayments();
    
    res.json({ success: true, message: 'Payment saved' });
  } catch (error) {
    console.error('Error saving payment:', error);
    res.status(500).json({ error: 'Failed to save payment' });
  }
});

// API endpoint to check payment status
app.get('/api/payment-status/:paymentId', (req, res) => {
  const { paymentId } = req.params;
  const payment = payments.get(paymentId);
  
  if (payment) {
    res.json(payment);
  } else {
    res.status(404).json({ error: 'Payment not found' });
  }
});

// API endpoint to get all payments
app.get('/api/payments', (req, res) => {
  const allPayments = Array.from(payments.entries()).map(([id, data]) => ({
    id,
    ...data
  }));
  res.json(allPayments);
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Return URL handler - where users land after payment
app.get('/payment-return', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'return.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/api/webhook`);
});