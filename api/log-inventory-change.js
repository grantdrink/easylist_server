import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables for Supabase');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async (req, res) => {
  console.log('📝 Log inventory change request received');
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      inventory_id, 
      business_id, 
      change_type, 
      quantity_before, 
      quantity_after, 
      reason, 
      purchase_id, 
      notes 
    } = req.body;

    if (!inventory_id || !business_id || !change_type || 
        quantity_before === undefined || quantity_after === undefined) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: 'inventory_id, business_id, change_type, quantity_before, and quantity_after are required'
      });
    }

    console.log(`Logging inventory change: ${inventory_id}, ${change_type}, ${quantity_before} → ${quantity_after}`);

    // Call the database function to log the change
    const { data, error } = await supabase
      .rpc('log_inventory_change', {
        p_inventory_id: parseInt(inventory_id),
        p_business_id: business_id,
        p_change_type: change_type,
        p_quantity_before: parseInt(quantity_before),
        p_quantity_after: parseInt(quantity_after),
        p_reason: reason || null,
        p_purchase_id: purchase_id ? parseInt(purchase_id) : null,
        p_notes: notes || null
      });

    if (error) {
      console.error('Error logging inventory change:', error);
      return res.status(500).json({ 
        error: 'Failed to log inventory change',
        details: error.message
      });
    }

    console.log(`✅ Successfully logged inventory change with ID: ${data}`);
    return res.status(200).json({ 
      success: true, 
      history_id: data,
      message: 'Inventory change logged successfully'
    });

  } catch (error) {
    console.error('❌ Unexpected error in log-inventory-change:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
};
