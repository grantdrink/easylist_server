import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req, res) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🚀 Starting email notification processing...');

    // Get all pending email notifications
    const { data: pendingEmails, error: fetchError } = await supabase
      .from('notification_logs')
      .select(`
        id,
        business_id,
        inventory_id,
        recipient,
        subject,
        message,
        created_at,
        inventory!inner(item_name, current_stock, threshold),
        businesses!inner(name)
      `)
      .eq('notification_type', 'email')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('❌ Error fetching pending emails:', fetchError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch pending notifications' 
      });
    }

    if (!pendingEmails || pendingEmails.length === 0) {
      console.log('✅ No pending email notifications found');
      return res.status(200).json({ 
        success: true, 
        message: 'No pending email notifications',
        sent: 0
      });
    }

    console.log(`📧 Found ${pendingEmails.length} pending email notifications`);

    // Process each email
    let successCount = 0;
    let failureCount = 0;

    for (const notification of pendingEmails) {
      try {
        console.log(`📤 Sending email to ${notification.recipient} for item: ${notification.inventory.item_name}`);

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
                <p style="margin: 5px 0 0 0; opacity: 0.9;">${notification.businesses.name}</p>
              </div>
              
              <div class="content">
                <div class="alert-box">
                  <h2 style="color: #dc2626; margin-top: 0;">${notification.inventory.item_name}</h2>
                  <p><strong>Your inventory is running low and needs attention!</strong></p>
                </div>
                
                <div class="stats">
                  <div class="stat">
                    <div class="stat-value">${notification.inventory.current_stock}</div>
                    <div class="stat-label">Current Stock</div>
                  </div>
                  <div class="stat">
                    <div class="stat-value">${notification.inventory.threshold}</div>
                    <div class="stat-label">Threshold</div>
                  </div>
                </div>
                
                <p><strong>Action Required:</strong> Consider restocking <em>${notification.inventory.item_name}</em> to avoid running out.</p>
                
                <p>This alert was sent because your current stock (${notification.inventory.current_stock}) has reached or fallen below your threshold (${notification.inventory.threshold}).</p>
              </div>
              
              <div class="footer">
                <p>This notification was sent by EasyList inventory management system.</p>
                <p>Sent on ${new Date(notification.created_at).toLocaleString()}</p>
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
            to: [notification.recipient],
            subject: notification.subject || `Low Stock Alert: ${notification.inventory.item_name}`,
            html: emailHtml,
            text: notification.message // Fallback plain text
          }),
        });

        const emailResult = await emailResponse.json();

        if (emailResponse.ok) {
          console.log(`✅ Email sent successfully to ${notification.recipient}`, emailResult);
          
          // Update notification status to sent
          await supabase
            .from('notification_logs')
            .update({ 
              status: 'sent', 
              sent_at: new Date().toISOString(),
              error_message: null
            })
            .eq('id', notification.id);

          successCount++;
        } else {
          console.error(`❌ Failed to send email to ${notification.recipient}:`, emailResult);
          
          // Update notification status to failed
          await supabase
            .from('notification_logs')
            .update({ 
              status: 'failed',
              error_message: emailResult.message || 'Email delivery failed'
            })
            .eq('id', notification.id);

          failureCount++;
        }

      } catch (emailError) {
        console.error(`❌ Error processing email for ${notification.recipient}:`, emailError);
        
        // Update notification status to failed
        await supabase
          .from('notification_logs')
          .update({ 
            status: 'failed',
            error_message: emailError.message || 'Unknown error'
          })
          .eq('id', notification.id);

        failureCount++;
      }

      // Rate limiting: Wait between emails to avoid Resend limits (2 emails/second max)
      await new Promise(resolve => setTimeout(resolve, 600)); // 600ms = ~1.5 emails/second
    }

    console.log(`📊 Email processing complete - Success: ${successCount}, Failed: ${failureCount}`);

    return res.status(200).json({
      success: true,
      message: `Processed ${pendingEmails.length} email notifications`,
      sent: successCount,
      failed: failureCount,
      total: pendingEmails.length
    });

  } catch (error) {
    console.error('❌ Error in email notification processing:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
};
