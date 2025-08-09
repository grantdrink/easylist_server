# EasyList API Server

This is the backend server for EasyList that handles Stripe webhooks and subscription management.

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start the server
npm run dev

# Test endpoints
npm test
```

The server will run on `http://localhost:3001`

### Production Deployment on Railway

1. **Create New Railway Project**
   ```bash
   # In this directory
   railway login
   railway init
   railway up
   ```

2. **Set Environment Variables**
   In Railway dashboard, add these environment variables:
   ```
   VITE_STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
   VITE_STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

3. **Get Your Server URL**
   Railway will provide a URL like: `https://easylist-server-production.up.railway.app`

## 📋 API Endpoints

### Health Check
```
GET /api/health
```
Returns server status and environment check.

### Stripe Webhook
```
POST /api/stripe-webhook
```
Handles Stripe payment completion events.

### Activate Subscription
```
POST /api/activate-subscription
Body: { "user_id": "uuid" }
```
Manually activates a user's subscription.

### Webhook Test
```
GET /api/webhook-test
```
Simple endpoint to test connectivity.

## 🔧 Configuration

### Stripe Webhook Setup

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Set endpoint URL: `https://your-server-url.railway.app/api/stripe-webhook`
4. Select events: `checkout.session.completed`
5. Copy the webhook signing secret to your environment variables

### Frontend Integration

Update your frontend's PaymentSuccess component to use your server URL:

```javascript
const response = await fetch('https://your-server-url.railway.app/api/activate-subscription', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id: user.id }),
});
```

## 🐛 Debugging

### Check Server Logs
Railway provides real-time logs in the dashboard.

### Test Endpoints
```bash
# Health check
curl https://your-server-url.railway.app/api/health

# Webhook test
curl https://your-server-url.railway.app/api/webhook-test
```

### Common Issues

1. **CORS Errors**: Server is configured to allow your frontend domain
2. **Environment Variables**: Check `/api/health` for missing variables
3. **Webhook Signature**: Verify webhook secret in Stripe dashboard

## 🔄 Deployment Process

1. **Deploy Server First**: Get your Railway server URL
2. **Update Frontend**: Point API calls to server URL
3. **Configure Stripe**: Update webhook endpoint URL
4. **Test Flow**: Complete payment → check webhook → verify activation

Your Stripe webhook will now properly activate subscriptions in your database!
