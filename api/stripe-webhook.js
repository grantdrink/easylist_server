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

      // UPDATED APPROACH: Try to find existing subscription by Stripe customer ID first
      // This handles the case where the user already linked their subscription via the token system
      let subscriptionRecord = null;
      
      if (session.customer) {
        const { data: existingSubscription } = await supabase
          .from('user_subscriptions')
          .select('*')
          .eq('stripe_customer_id', session.customer)
          .single();
          
        if (existingSubscription) {
          console.log('✅ Found existing subscription for customer:', session.customer);
          subscriptionRecord = existingSubscription;
        }
      }
      
      // If no existing subscription found, try to find by Stripe email
      if (!subscriptionRecord) {
        const { data: emailBasedSubscription } = await supabase
          .from('user_subscriptions')
          .select('*')
          .eq('stripe_email', customerEmail)
          .single();
          
        if (emailBasedSubscription) {
          console.log('✅ Found existing subscription for Stripe email:', customerEmail);
          subscriptionRecord = emailBasedSubscription;
        }
      }
      
      // If still no subscription found, try the old email matching approach as fallback
      if (!subscriptionRecord) {
        console.log('🔍 No existing subscription found, trying email matching as fallback...');
        
        // Find user by email in Supabase auth
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        
        if (listError) {
          console.error('❌ Error listing users:', listError);
          return res.status(500).json({ error: 'Failed to find user' });
        }

        const user = users.find(u => u.email === customerEmail);
        
        if (!user) {
          console.log('⚠️ No user found for email:', customerEmail);
          console.log('ℹ️ This is normal if the user used a different email for Stripe than for EasyList.');
          console.log('ℹ️ The subscription will be linked when the user completes the token-based flow.');
          return res.status(200).json({ 
            message: 'Payment processed, but subscription linking will be handled by token-based flow',
            stripe_customer_id: session.customer,
            stripe_email: customerEmail
          });
        }

        console.log('👤 Found user by email fallback:', user.id);
        
        // Create subscription record for email-matched user
        subscriptionRecord = {
          user_id: user.id,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          stripe_email: customerEmail,
          subscription_status: 'active',
          payment_method_attached: true,
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      
      // Update or create the subscription record
      if (subscriptionRecord.user_id) {
        const { data, error } = await supabase
          .from('user_subscriptions')
          .upsert({
            user_id: subscriptionRecord.user_id,
            subscription_status: 'active',
            payment_method_attached: true,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            stripe_email: customerEmail,
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id'
          })
          .select()
          .single();

        if (error) {
          console.error('❌ Database error:', error);
          return res.status(500).json({ error: 'Failed to activate subscription' });
        }

        console.log('✅ Subscription activated for user:', subscriptionRecord.user_id);
        return res.status(200).json({ success: true, user_id: subscriptionRecord.user_id });
      }
      
      // This shouldn't happen with the new logic, but just in case
      console.log('⚠️ Unable to link subscription - this will be handled by token-based flow');
      return res.status(200).json({ message: 'Payment received, subscription linking pending' });
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

          // Handle invoice payment (for subscriptions)
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      console.log('💰 Invoice payment succeeded:', invoice.id);
      
      if (invoice.billing_reason === 'subscription_create') {
        console.log('🆕 New subscription payment detected');
        
        // Get customer email from invoice
        const customerId = invoice.customer;
        const customerEmail = invoice.customer_email;
        
        console.log('📧 Customer ID:', customerId);
        console.log('📧 Customer email:', customerEmail);
        
        if (!customerEmail) {
          console.error('❌ No customer email found in invoice');
          return res.status(400).json({ error: 'No customer email found' });
        }

        // UPDATED APPROACH: Try to find existing subscription by Stripe customer ID first
        let subscriptionRecord = null;
        
        if (customerId) {
          const { data: existingSubscription } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('stripe_customer_id', customerId)
            .single();
            
          if (existingSubscription) {
            console.log('✅ Found existing subscription for customer:', customerId);
            subscriptionRecord = existingSubscription;
          }
        }
        
        // If no existing subscription found, try to find by Stripe email
        if (!subscriptionRecord) {
          const { data: emailBasedSubscription } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('stripe_email', customerEmail)
            .single();
            
          if (emailBasedSubscription) {
            console.log('✅ Found existing subscription for Stripe email:', customerEmail);
            subscriptionRecord = emailBasedSubscription;
          }
        }
        
        // If still no subscription found, try the old email matching approach as fallback
        if (!subscriptionRecord) {
          console.log('🔍 No existing subscription found, trying email matching as fallback...');
          
          // Find user by email in Supabase auth
          const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
          
          if (listError) {
            console.error('❌ Error listing users:', listError);
            return res.status(500).json({ error: 'Failed to find user' });
          }

          const user = users.find(u => u.email === customerEmail);
          
          if (!user) {
            console.log('⚠️ No user found for email:', customerEmail);
            console.log('ℹ️ This is normal if the user used a different email for Stripe than for EasyList.');
            console.log('ℹ️ The subscription will be linked when the user completes the token-based flow.');
            return res.status(200).json({ 
              message: 'Invoice payment processed, but subscription linking will be handled by token-based flow',
              stripe_customer_id: customerId,
              stripe_email: customerEmail
            });
          }

          console.log('👤 Found user by email fallback:', user.id);
          
          // Create subscription record for email-matched user
          subscriptionRecord = {
            user_id: user.id,
            stripe_customer_id: customerId,
            stripe_subscription_id: invoice.subscription,
            stripe_email: customerEmail,
            subscription_status: 'active',
            payment_method_attached: true,
            current_period_start: new Date(invoice.period_start * 1000).toISOString(),
            current_period_end: new Date(invoice.period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          };
        }
        
        // Update or create the subscription record
        if (subscriptionRecord.user_id) {
          const { data, error } = await supabase
            .from('user_subscriptions')
            .upsert({
              user_id: subscriptionRecord.user_id,
              subscription_status: 'active',
              payment_method_attached: true,
              stripe_customer_id: customerId,
              stripe_subscription_id: invoice.subscription,
              stripe_email: customerEmail,
              current_period_start: new Date(invoice.period_start * 1000).toISOString(),
              current_period_end: new Date(invoice.period_end * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'user_id'
            })
            .select()
            .single();

          if (error) {
            console.error('❌ Database error for invoice:', error);
            return res.status(500).json({ error: 'Failed to activate subscription' });
          }

          console.log('✅ Subscription activated for invoice payment:', subscriptionRecord.user_id);
          return res.status(200).json({ success: true, user_id: subscriptionRecord.user_id, event_type: 'invoice.payment_succeeded' });
        }
        
        // This shouldn't happen with the new logic, but just in case
        console.log('⚠️ Unable to link invoice payment - this will be handled by token-based flow');
        return res.status(200).json({ message: 'Invoice payment received, subscription linking pending' });
      }
    }

    // Handle invoice payment failure - CRITICAL for cutting off non-paying users
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      console.log('💸 Invoice payment failed:', invoice.id);

      // Update subscription status to unpaid (blocks access)
      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          subscription_status: 'unpaid',
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', invoice.subscription);

      if (error) {
        console.error('❌ Failed to update subscription to unpaid:', error);
        return res.status(500).json({ error: 'Failed to update subscription' });
      }

      console.log('🚫 Subscription set to unpaid - user access blocked');
    }

    // Handle subscription cancellation - immediately cut off access
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      console.log('🗑️ Subscription canceled:', subscription.id);

      // Set status to canceled (blocks access)
      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          subscription_status: 'canceled',
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscription.id);

      if (error) {
        console.error('❌ Failed to update canceled subscription:', error);
        return res.status(500).json({ error: 'Failed to update subscription' });
      }

      console.log('✅ Subscription marked as canceled - user access blocked');
    }

    // Handle trial ending - this is CRITICAL for cutting off trial users
    if (event.type === 'customer.subscription.trial_will_end') {
      const subscription = event.data.object;
      console.log('⏰ Trial ending soon for subscription:', subscription.id);

      // Optional: Send notification email or update status
      // This gives you a 3-day warning before trial ends
      console.log('📧 Consider sending trial ending notification to user');
    }

    // Handle subscription paused/incomplete - for failed trial conversions
    if (event.type === 'customer.subscription.paused') {
      const subscription = event.data.object;
      console.log('⏸️ Subscription paused:', subscription.id);

      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          subscription_status: 'canceled',
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscription.id);

      if (error) {
        console.error('❌ Failed to update paused subscription:', error);
      } else {
        console.log('✅ Paused subscription marked as canceled - access blocked');
      }
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}
