import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import API handlers
import stripeWebhookHandler from './api/stripe-webhook.js';
import activateSubscriptionHandler from './api/activate-subscription.js';
import webhookTestHandler from './api/webhook-test.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

console.log('🚀 Starting EasyList API Server...');
console.log('🔧 Environment Variables Check:');
console.log('  - VITE_STRIPE_SECRET_KEY:', !!process.env.VITE_STRIPE_SECRET_KEY);
console.log('  - VITE_STRIPE_WEBHOOK_SECRET:', !!process.env.VITE_STRIPE_WEBHOOK_SECRET);
console.log('  - VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL);
console.log('  - VITE_SUPABASE_SERVICE_ROLE_KEY:', !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

// CORS configuration - Allow your frontend domain
app.use(cors({
  origin: [
    'http://localhost:5173',  // Vite dev server
    'http://localhost:3000',  // Alternative dev port
    'https://shotgunly.com',  // Your production domain
    /^https:\/\/.*\.railway\.app$/, // Railway preview URLs
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature']
}));

// Special handling for Stripe webhook - needs raw body
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));

// Regular JSON parsing for other endpoints
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'EasyList API Server',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: [
      'GET /api/health',
      'POST /api/stripe-webhook', 
      'POST /api/activate-subscription',
      'GET /api/webhook-test'
    ],
    env_check: {
      stripe_secret_key: !!process.env.VITE_STRIPE_SECRET_KEY,
      stripe_webhook_secret: !!process.env.VITE_STRIPE_WEBHOOK_SECRET,
      supabase_url: !!process.env.VITE_SUPABASE_URL,
      supabase_service_key: !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
    }
  });
});

// API Routes
app.post('/api/stripe-webhook', stripeWebhookHandler);
app.post('/api/activate-subscription', activateSubscriptionHandler);
app.all('/api/webhook-test', webhookTestHandler);

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'EasyList API Server',
    status: 'running',
    docs: 'Use /api/health for service status',
    frontend: 'https://shotgunly.com'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.originalUrl,
    available_endpoints: [
      'GET /',
      'GET /api/health',
      'POST /api/stripe-webhook', 
      'POST /api/activate-subscription',
      'GET /api/webhook-test'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log('✅ EasyList API Server is running!');
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🎯 Ready to receive Stripe webhooks at: http://localhost:${PORT}/api/stripe-webhook`);
});
