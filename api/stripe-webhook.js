import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.VITE_STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log('🌟 ================================');
  console.log('🌟 STRIPE WEBHOOK CALLED!');
  console.log('🌟 Timestamp:', new Date().toISOString());
  console.log('🌟 Method:', req.method);
  console.log('🌟 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('🌟 Environment check:');
  console.log('  - VITE_STRIPE_SECRET_KEY:', !!process.env.VITE_STRIPE_SECRET_KEY);
  console.log('  - VITE_STRIPE_WEBHOOK_SECRET:', !!process.env.VITE_STRIPE_WEBHOOK_SECRET);
  console.log('  - VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL);
  console.log('  - VITE_SUPABASE_SERVICE_ROLE_KEY:', !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);
  console.log('🌟 ================================');

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
      console.log('🔍 Session metadata:', JSON.stringify(session.metadata, null, 2));
      console.log('🔍 Client reference ID:', session.client_reference_id);

      // FOOLPROOF APPROACH: Check client_reference_id for pre-stored payment link
      const clientReferenceId = session.client_reference_id;
      
      if (clientReferenceId) {
        console.log('🎯 FOUND CLIENT REFERENCE ID - CHECKING PENDING PAYMENTS');
        console.log('🔍 Looking for session ID:', clientReferenceId);
        
        // Find the pending payment record
        const { data: pendingPayment, error: pendingError } = await supabase
          .from('pending_payments')
          .select('*')
          .eq('session_id', clientReferenceId)
          .eq('status', 'pending')
          .single();
          
        if (pendingError || !pendingPayment) {
          console.error('❌ No pending payment found for session:', clientReferenceId, pendingError);
        } else {
          console.log('🎉 FOUND PENDING PAYMENT!');
          console.log('👤 User ID:', pendingPayment.user_id);
          console.log('📧 User Email:', pendingPayment.user_email);
          console.log('💳 Stripe Email:', customerEmail);
          
          // Create/update subscription record
          const subscriptionData = {
            user_id: pendingPayment.user_id,
            user_email: pendingPayment.user_email,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            stripe_email: customerEmail,
            subscription_status: 'active',
            payment_method_attached: true,
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          };

          console.log('🔍 Creating subscription:', JSON.stringify(subscriptionData, null, 2));

          const { data, error } = await supabase
            .from('user_subscriptions')
            .upsert(subscriptionData, {
              onConflict: 'user_id'
            })
            .select()
            .single();

          if (error) {
            console.error('❌ Failed to create subscription:', error);
          } else {
            // Mark pending payment as completed
            await supabase
              .from('pending_payments')
              .update({ 
                status: 'completed',
                stripe_customer_id: session.customer,
                stripe_email: customerEmail,
                processed_at: new Date().toISOString()
              })
              .eq('session_id', clientReferenceId);

            console.log('🎉 FOOLPROOF PAYMENT LINKING SUCCESSFUL!');
            console.log('✅ User:', pendingPayment.user_id, '(' + pendingPayment.user_email + ')');
            console.log('✅ Stripe Email:', customerEmail);
            
            return res.status(200).json({ 
              success: true, 
              user_id: pendingPayment.user_id,
              message: 'Subscription automatically activated via foolproof linking',
              platform_email: pendingPayment.user_email,
              stripe_email: customerEmail
            });
          }
        }
      }

      // BACKUP: Try metadata approach
      const paymentToken = session.metadata?.payment_token;
      const userId = session.metadata?.user_id;
      const platformEmail = session.metadata?.platform_email;

      if (paymentToken && userId) {
        console.log('🎯 AUTOMATIC TOKEN-BASED LINKING');
        console.log('🎫 Payment token from metadata:', paymentToken);
        console.log('👤 User ID from metadata:', userId);
        console.log('📧 Platform email from metadata:', platformEmail);

        // Verify the token exists and is valid
        const { data: tokenData, error: tokenError } = await supabase
          .from('payment_tokens')
          .select('user_id, used, expires_at')
          .eq('token', paymentToken)
          .single();

        if (tokenError || !tokenData) {
          console.error('❌ Invalid token in session metadata:', tokenError);
        } else if (tokenData.used) {
          console.log('⚠️ Token already used, but proceeding with webhook');
        } else if (new Date(tokenData.expires_at) < new Date()) {
          console.log('⚠️ Token expired, but proceeding with webhook');
        } else {
          console.log('✅ Valid token found, proceeding with automatic linking');
        }

        // Create/update subscription record automatically
        const subscriptionData = {
          user_id: userId,
          user_email: platformEmail,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          stripe_email: customerEmail,
          subscription_status: 'active',
          payment_method_attached: true,
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        };

        console.log('🔍 Creating subscription record:', JSON.stringify(subscriptionData, null, 2));

        const { data, error } = await supabase
          .from('user_subscriptions')
          .upsert(subscriptionData, {
            onConflict: 'user_id'
          })
          .select()
          .single();

        if (error) {
          console.error('❌ Database error:', error);
          return res.status(500).json({ error: 'Failed to activate subscription' });
        }

        // Mark token as used
        if (tokenData && !tokenData.used) {
          await supabase
            .from('payment_tokens')
            .update({ used: true })
            .eq('token', paymentToken);
          console.log('✅ Payment token marked as used');
        }

        console.log('🎉 AUTOMATIC SUBSCRIPTION ACTIVATION SUCCESSFUL!');
        console.log('✅ User:', userId, '(' + platformEmail + ')');
        console.log('✅ Stripe email:', customerEmail);
        console.log('✅ Customer ID:', session.customer);
        console.log('✅ Subscription ID:', session.subscription);
        
        return res.status(200).json({ 
          success: true, 
          user_id: userId,
          message: 'Subscription automatically activated via token-based linking',
          platform_email: platformEmail,
          stripe_email: customerEmail
        });
      }

      // FALLBACK: Try to find existing subscription by Stripe customer ID
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
      
      // NO TOKEN AND NO EXISTING SUBSCRIPTION - Payment cannot be linked automatically
      if (!subscriptionRecord) {
        console.log('🔍 ================================');
        console.log('🔍 NO TOKEN AND NO EXISTING SUBSCRIPTION FOUND');
        console.log('🔍 This indicates an old payment or payment not initiated through our system');
        console.log('🔍 Customer ID searched:', session.customer);
        console.log('🔍 Stripe email searched:', customerEmail);
        console.log('🔍 Session metadata:', JSON.stringify(session.metadata, null, 2));
        console.log('ℹ️ Webhook cannot automatically link this payment');
        console.log('🔍 ================================');
        return res.status(200).json({ 
          message: 'Payment received but cannot be automatically linked. No token in metadata.',
          stripe_customer_id: session.customer,
          stripe_email: customerEmail,
          session_id: session.id
        });
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

    // Handle new subscription creation - CRITICAL for linking session_id to subscription
    if (event.type === 'customer.subscription.created') {
      const subscription = event.data.object;
      console.log('🆕 New subscription created:', subscription.id);
      console.log('🔍 Customer ID:', subscription.customer);
      
      // Check if this subscription came from a checkout session with client_reference_id
      try {
        const stripe = (await import('stripe')).default(process.env.VITE_STRIPE_SECRET_KEY);
        
        // Find recent checkout sessions for this customer
        const sessions = await stripe.checkout.sessions.list({
          customer: subscription.customer,
          limit: 10
        });
        
        console.log(`🔍 Found ${sessions.data.length} checkout sessions for customer`);
        
        // Look for a session with client_reference_id (our session_id)
        const sessionWithReference = sessions.data.find(session => session.client_reference_id);
        
        if (sessionWithReference && sessionWithReference.client_reference_id) {
          const sessionId = sessionWithReference.client_reference_id;
          console.log('🎯 FOUND CLIENT REFERENCE ID IN CHECKOUT SESSION:', sessionId);
          
          // Update the subscription metadata with the session_id
          await stripe.subscriptions.update(subscription.id, {
            metadata: {
              session_id: sessionId
            }
          });
          
          console.log('✅ Updated subscription metadata with session_id:', sessionId);
          
          // Also check if we have a pending payment for this session
          const { data: pendingPayment } = await supabase
            .from('pending_payments')
            .select('*')
            .eq('session_id', sessionId)
            .eq('status', 'pending')
            .single();
            
          if (pendingPayment) {
            console.log('🎉 FOUND MATCHING PENDING PAYMENT!');
            console.log('👤 User:', pendingPayment.user_id, '(' + pendingPayment.user_email + ')');
          }
        } else {
          console.log('⚠️ No client_reference_id found in recent checkout sessions');
        }
      } catch (error) {
        console.error('❌ Error linking session_id to subscription:', error);
      }
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

        // FOOLPROOF APPROACH: Check subscription metadata for session_id
        const subscriptionId = invoice.subscription;
        console.log('🔍 Checking subscription metadata for session_id:', subscriptionId);
        
        if (subscriptionId) {
          try {
            const stripe = (await import('stripe')).default(process.env.VITE_STRIPE_SECRET_KEY);
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            console.log('🔍 Subscription metadata:', JSON.stringify(subscription.metadata, null, 2));
            
            const sessionId = subscription.metadata?.session_id;
            if (sessionId) {
              console.log('🎯 FOUND SESSION ID IN SUBSCRIPTION METADATA!');
              console.log('🔍 Looking for pending payment:', sessionId);
              
              // Find the pending payment record
              const { data: pendingPayment, error: pendingError } = await supabase
                .from('pending_payments')
                .select('*')
                .eq('session_id', sessionId)
                .eq('status', 'pending')
                .single();
                
              if (pendingError || !pendingPayment) {
                console.error('❌ No pending payment found for session:', sessionId, pendingError);
              } else {
                console.log('🎉 FOUND PENDING PAYMENT FOR INVOICE!');
                console.log('👤 User ID:', pendingPayment.user_id);
                console.log('📧 User Email:', pendingPayment.user_email);
                console.log('💳 Stripe Email:', customerEmail);
                
                // Create/update subscription record
                const subscriptionData = {
                  user_id: pendingPayment.user_id,
                  user_email: pendingPayment.user_email,
                  stripe_customer_id: customerId,
                  stripe_subscription_id: subscriptionId,
                  stripe_email: customerEmail,
                  subscription_status: 'active',
                  payment_method_attached: true,
                  current_period_start: new Date().toISOString(),
                  current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                  updated_at: new Date().toISOString(),
                };

                console.log('🔍 Creating subscription from invoice:', JSON.stringify(subscriptionData, null, 2));

                const { data, error } = await supabase
                  .from('user_subscriptions')
                  .upsert(subscriptionData, {
                    onConflict: 'user_id'
                  })
                  .select()
                  .single();

                if (error) {
                  console.error('❌ Failed to create subscription from invoice:', error);
                } else {
                  // Mark pending payment as completed
                  await supabase
                    .from('pending_payments')
                    .update({ 
                      status: 'completed',
                      stripe_customer_id: customerId,
                      stripe_email: customerEmail,
                      processed_at: new Date().toISOString()
                    })
                    .eq('session_id', sessionId);

                  console.log('🎉 FOOLPROOF INVOICE LINKING SUCCESSFUL!');
                  console.log('✅ User:', pendingPayment.user_id, '(' + pendingPayment.user_email + ')');
                  console.log('✅ Stripe Email:', customerEmail);
                  
                  return res.status(200).json({ 
                    success: true, 
                    user_id: pendingPayment.user_id,
                    message: 'Subscription automatically activated via invoice foolproof linking',
                    platform_email: pendingPayment.user_email,
                    stripe_email: customerEmail
                  });
                }
              }
            }
          } catch (stripeError) {
            console.error('❌ Error fetching subscription metadata:', stripeError);
          }
        }

        // FALLBACK: Try to find existing subscription by Stripe customer ID first
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
        
        // CHECK FOR TOKEN IN SUBSCRIPTION METADATA (for checkout sessions)
        let paymentToken = null;
        let userId = null;
        let platformEmail = null;

        if (invoice.subscription) {
          console.log('🔍 Checking subscription metadata for token...');
          try {
            const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
            console.log('🔍 Subscription metadata:', JSON.stringify(subscription.metadata, null, 2));
            
            paymentToken = subscription.metadata?.payment_token;
            userId = subscription.metadata?.user_id;
            platformEmail = subscription.metadata?.platform_email;
            
            if (paymentToken && userId) {
              console.log('🎯 FOUND TOKEN IN SUBSCRIPTION METADATA!');
              console.log('🎫 Payment token:', paymentToken);
              console.log('👤 User ID:', userId);
              console.log('📧 Platform email:', platformEmail);
            }
          } catch (error) {
            console.error('❌ Error retrieving subscription metadata:', error);
          }
        }

        if (paymentToken && userId) {
          console.log('🎯 AUTOMATIC TOKEN-BASED LINKING (FROM INVOICE)');

          // Verify the token exists and is valid
          const { data: tokenData, error: tokenError } = await supabase
            .from('payment_tokens')
            .select('user_id, used, expires_at')
            .eq('token', paymentToken)
            .single();

          if (tokenError || !tokenData) {
            console.error('❌ Invalid token in subscription metadata:', tokenError);
          } else {
            console.log('✅ Valid token found, proceeding with automatic linking');
          }

          // Create/update subscription record automatically
          const subscriptionData = {
            user_id: userId,
            user_email: platformEmail,
            stripe_customer_id: customerId,
            stripe_subscription_id: invoice.subscription,
            stripe_email: customerEmail,
            subscription_status: 'active',
            payment_method_attached: true,
            current_period_start: new Date(invoice.period_start * 1000).toISOString(),
            current_period_end: new Date(invoice.period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          };

          console.log('🔍 Creating subscription record from invoice:', JSON.stringify(subscriptionData, null, 2));

          const { data, error } = await supabase
            .from('user_subscriptions')
            .upsert(subscriptionData, {
              onConflict: 'user_id'
            })
            .select()
            .single();

          if (error) {
            console.error('❌ Database error:', error);
            return res.status(500).json({ error: 'Failed to activate subscription' });
          }

          // Mark token as used
          if (tokenData && !tokenData.used) {
            await supabase
              .from('payment_tokens')
              .update({ used: true })
              .eq('token', paymentToken);
            console.log('✅ Payment token marked as used');
          }

          console.log('🎉 AUTOMATIC SUBSCRIPTION ACTIVATION SUCCESSFUL (FROM INVOICE)!');
          console.log('✅ User:', userId, '(' + platformEmail + ')');
          console.log('✅ Stripe email:', customerEmail);
          console.log('✅ Customer ID:', customerId);
          console.log('✅ Subscription ID:', invoice.subscription);
          
          return res.status(200).json({ 
            success: true, 
            user_id: userId,
            message: 'Subscription automatically activated via token-based linking (from invoice)',
            platform_email: platformEmail,
            stripe_email: customerEmail
          });
        }

        // NO TOKEN FOUND - Check if same email can be linked
        if (!subscriptionRecord) {
          console.log('🔍 No token in subscription metadata, checking for same-email linking...');
          
          // For same-email scenarios, we can safely link automatically
          if (customerEmail) {
            console.log('🔍 Attempting same-email linking for:', customerEmail);
            
            // Find user by email in Supabase auth
            const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
            
            if (listError) {
              console.error('❌ Error listing users:', listError);
              return res.status(500).json({ error: 'Failed to find user' });
            }

            const user = users.find(u => u.email === customerEmail);
            
            if (user) {
              console.log('✅ Found user with same email - safe to link:', user.id);
              
              // Create subscription record for same-email user
              const subscriptionData = {
                user_id: user.id,
                user_email: customerEmail,
                stripe_customer_id: customerId,
                stripe_subscription_id: invoice.subscription,
                stripe_email: customerEmail,
                subscription_status: 'active',
                payment_method_attached: true,
                current_period_start: new Date(invoice.period_start * 1000).toISOString(),
                current_period_end: new Date(invoice.period_end * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              };

              const { data, error } = await supabase
                .from('user_subscriptions')
                .upsert(subscriptionData, {
                  onConflict: 'user_id'
                })
                .select()
                .single();

              if (error) {
                console.error('❌ Database error for same-email linking:', error);
                return res.status(500).json({ error: 'Failed to activate subscription' });
              }

              console.log('🎉 SAME-EMAIL SUBSCRIPTION ACTIVATION SUCCESSFUL!');
              console.log('✅ User:', user.id, '(' + customerEmail + ')');
              
              return res.status(200).json({ 
                success: true, 
                user_id: user.id,
                message: 'Subscription automatically activated via same-email linking'
              });
            }
          }
          
          console.log('🔍 No existing subscription found for invoice payment.');
          console.log('ℹ️ No token in metadata and no same-email user found.');
          console.log('ℹ️ This indicates different emails were used but checkout session was not used.');
          return res.status(200).json({ 
            message: 'Invoice payment received but cannot be automatically linked. Use checkout session for different emails.',
            stripe_customer_id: customerId,
            stripe_email: customerEmail,
            note: 'No token in subscription metadata - different emails require checkout session'
          });
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
