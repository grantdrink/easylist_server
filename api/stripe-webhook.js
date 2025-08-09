import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.VITE_STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log('🌟 STRIPE WEBHOOK CALLED!');
  console.log('🌟 Method:', req.method);
  console.log('🌟 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('🌟 Environment check:');
  console.log('  - VITE_STRIPE_SECRET_KEY:', !!process.env.VITE_STRIPE_SECRET_KEY);
  console.log('  - VITE_STRIPE_WEBHOOK_SECRET:', !!process.env.VITE_STRIPE_WEBHOOK_SECRET);
  console.log('  - VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL);
  console.log('  - VITE_SUPABASE_SERVICE_ROLE_KEY:', !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

  if (req.method !== 'POST') {
    console.log('❌ Wrong method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.VITE_STRIPE_WEBHOOK_SECRET;

  console.log('🔑 Webhook signature present:', !!sig);
  console.log('🔑 Webhook secret configured:', !!webhookSecret);

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log('✅ Webhook signature verified! Event type:', event.type);
    console.log('📦 Event data:', JSON.stringify(event.data, null, 2));
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    console.error('❌ Full error:', err);
    return res.status(400).json({ error: 'Webhook signature verification failed', details: err.message });
  }

  try {
    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('🎉 Payment completed:', session.id);
      
      // Get customer email from the session
      const customerEmail = session.customer_details?.email || session.customer_email;
      
      if (!customerEmail) {
        console.error('❌ No customer email found in session');
        return res.status(400).json({ error: 'No customer email found' });
      }

      console.log('📧 Customer email:', customerEmail);

      // Find user by email in Supabase auth
      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
      
      if (listError) {
        console.error('❌ Error listing users:', listError);
        return res.status(500).json({ error: 'Failed to find user' });
      }

      const user = users.find(u => u.email === customerEmail);
      
      if (!user) {
        console.error('❌ User not found for email:', customerEmail);
        return res.status(400).json({ error: 'User not found' });
      }

      console.log('👤 Found user:', user.id);

      // Activate the subscription
      const { data, error } = await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: user.id,
          subscription_status: 'active',
          payment_method_attached: true,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Database error:', error);
        return res.status(500).json({ error: 'Failed to activate subscription' });
      }

      console.log('✅ Subscription activated for user:', user.id);
      return res.status(200).json({ success: true, user_id: user.id });
    }

    // Handle subscription status updates
    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      console.log('📝 Subscription updated:', subscription.id);

      // Update subscription status in database
      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          subscription_status: subscription.status,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscription.id);

      if (error) {
        console.error('❌ Failed to update subscription:', error);
        return res.status(500).json({ error: 'Failed to update subscription' });
      }

      console.log('✅ Subscription status updated');
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}
