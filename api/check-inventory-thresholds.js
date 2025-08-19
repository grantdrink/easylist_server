// API endpoint to check inventory thresholds and send notifications
// This should be called periodically (e.g., via cron job or scheduled function)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY // Service role for admin access
);

// Email configuration using Resend
const sendEmail = async (to, subject, message, itemName, currentStock, threshold, businessName) => {
  console.log('📧 Sending email:', { to, subject, itemName });
  
  try {
    // Enhanced email content
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Low Stock Alert</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #8B5CF6; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
          .alert-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px; margin: 16px 0; }
          .stats { display: flex; justify-content: space-between; margin: 16px 0; }
          .stat { text-align: center; }
          .stat-value { font-size: 24px; font-weight: bold; color: #dc2626; }
          .stat-label { font-size: 14px; color: #6b7280; }
          .footer { margin-top: 20px; font-size: 12px; color: #6b7280; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">🚨 Low Stock Alert</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">${businessName}</p>
          </div>
          
          <div class="content">
            <div class="alert-box">
              <h2 style="color: #dc2626; margin-top: 0;">${itemName}</h2>
              <p><strong>Your inventory is running low and needs attention!</strong></p>
            </div>
            
            <div class="stats">
              <div class="stat">
                <div class="stat-value">${currentStock}</div>
                <div class="stat-label">Current Stock</div>
              </div>
              <div class="stat">
                <div class="stat-value">${threshold}</div>
                <div class="stat-label">Threshold</div>
              </div>
            </div>
            
            <p><strong>Action Required:</strong> Consider restocking <em>${itemName}</em> to avoid running out.</p>
            
            <p>This alert was sent because your current stock (${currentStock}) has reached or fallen below your threshold (${threshold}).</p>
          </div>
          
          <div class="footer">
            <p>This notification was sent by EasyList inventory management system.</p>
            <p>Sent on ${new Date().toLocaleString()}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email using Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VITE_RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'EasyList <notifications@easylist.app>', // You'll need to set up your domain
        to: [to],
        subject: subject || `Low Stock Alert: ${itemName}`,
        html: emailHtml,
        text: message // Fallback plain text
      }),
    });

    const emailResult = await emailResponse.json();

    if (emailResponse.ok) {
      console.log(`✅ Email sent successfully to ${to}`);
      return { success: true, message: 'Email sent successfully', id: emailResult.id };
    } else {
      console.error(`❌ Failed to send email to ${to}:`, emailResult);
      return { success: false, message: emailResult.message || 'Email delivery failed' };
    }

  } catch (error) {
    console.error(`❌ Error sending email to ${to}:`, error);
    return { success: false, message: error.message || 'Unknown email error' };
  }
};

// SMS configuration (using a service like Twilio)
const sendSMS = async (to, message) => {
  console.log('📱 Sending SMS:', { to, message });
  
  // TODO: Integrate with Twilio or similar SMS service
  // Example with Twilio:
  // const twilio = require('twilio');
  // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // await client.messages.create({
  //   body: message,
  //   from: process.env.TWILIO_PHONE_NUMBER,
  //   to: to
  // });
  
  // For now, just log and mark as sent
  return { success: true, message: 'SMS sent (simulated)' };
};

export default async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔍 Starting inventory threshold check...');

    // Get all businesses that have notification settings enabled
    const { data: businessesWithNotifications, error: businessError } = await supabase
      .from('notification_settings')
      .select(`
        business_id,
        email_notifications_enabled,
        sms_notifications_enabled,
        notification_email,
        notification_phone,
        businesses (
          name,
          owner_id
        )
      `)
      .or('email_notifications_enabled.eq.true,sms_notifications_enabled.eq.true');

    if (businessError) {
      throw businessError;
    }

    console.log(`📊 Found ${businessesWithNotifications?.length || 0} businesses with notifications enabled`);

    let totalNotifications = 0;

    // Check each business for low inventory
    for (const business of businessesWithNotifications || []) {
      try {
        console.log(`🏢 Checking business: ${business.businesses?.name}`);

        // Call the smart check_inventory_thresholds function for this business
        const { data: result, error: thresholdError } = await supabase
          .rpc('check_inventory_thresholds_smart', {
            p_business_id: business.business_id
          });

        if (thresholdError) {
          console.error(`Error checking thresholds for business ${business.business_id}:`, thresholdError);
          continue;
        }

        if (result?.notifications_created > 0) {
          console.log(`📝 Created ${result.notifications_created} notifications for ${business.businesses?.name}`);
          totalNotifications += result.notifications_created;

          // Now send the actual notifications
          await sendPendingNotifications(business.business_id);
        }

      } catch (error) {
        console.error(`Error processing business ${business.business_id}:`, error);
      }
    }

    console.log(`✅ Threshold check complete. Total notifications created: ${totalNotifications}`);

    res.status(200).json({
      success: true,
      message: `Checked ${businessesWithNotifications?.length || 0} businesses`,
      notifications_created: totalNotifications
    });

  } catch (error) {
    console.error('Error in threshold check:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

// Function to send pending notifications
async function sendPendingNotifications(businessId) {
  try {
    // Get pending notifications for this business
    const { data: pendingNotifications, error } = await supabase
      .from('notification_logs')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    console.log(`📨 Sending ${pendingNotifications?.length || 0} pending notifications`);

    for (const notification of pendingNotifications || []) {
      try {
        let sendResult;

        if (notification.notification_type === 'email') {
          // Get item details for enhanced email
          const { data: itemData } = await supabase
            .from('inventory')
            .select('item_name, current_stock, threshold')
            .eq('id', notification.inventory_id)
            .single();

          const { data: businessData } = await supabase
            .from('businesses')
            .select('name')
            .eq('id', notification.business_id)
            .single();

          sendResult = await sendEmail(
            notification.recipient,
            notification.subject,
            notification.message,
            itemData?.item_name || 'Unknown Item',
            itemData?.current_stock || 0,
            itemData?.threshold || 0,
            businessData?.name || 'Unknown Business'
          );
        } else if (notification.notification_type === 'sms') {
          sendResult = await sendSMS(
            notification.recipient,
            notification.message
          );
        }

        // Update notification status
        if (sendResult?.success) {
          await supabase
            .from('notification_logs')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString()
            })
            .eq('id', notification.id);

          console.log(`✅ Sent ${notification.notification_type} to ${notification.recipient}`);
        } else {
          await supabase
            .from('notification_logs')
            .update({
              status: 'failed',
              error_message: sendResult?.message || 'Unknown error'
            })
            .eq('id', notification.id);

          console.log(`❌ Failed to send ${notification.notification_type} to ${notification.recipient}`);
        }

      } catch (error) {
        console.error(`Error sending notification ${notification.id}:`, error);
        
        // Mark as failed
        await supabase
          .from('notification_logs')
          .update({
            status: 'failed',
            error_message: error.message
          })
          .eq('id', notification.id);
      }

      // Rate limiting: Wait between emails to avoid Resend limits (2 emails/second max)
      await new Promise(resolve => setTimeout(resolve, 600)); // 600ms = ~1.5 emails/second
    }

  } catch (error) {
    console.error('Error sending pending notifications:', error);
  }
}
