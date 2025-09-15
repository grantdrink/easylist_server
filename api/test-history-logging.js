import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables for Supabase');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async (req, res) => {
  console.log('🧪 Test history logging request received');
  
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
    const { inventory_id, business_id } = req.body;

    if (!inventory_id || !business_id) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: 'inventory_id and business_id are required'
      });
    }

    console.log(`Testing history logging for inventory_id: ${inventory_id}, business_id: ${business_id}`);

    // Step 1: Get current item state
    const { data: itemBefore, error: itemError } = await supabase
      .from('inventory')
      .select('id, name, quantity, business_id')
      .eq('id', inventory_id)
      .eq('business_id', business_id)
      .single();

    if (itemError) {
      return res.status(400).json({ 
        error: 'Item not found',
        details: itemError.message
      });
    }

    console.log('📦 Item before:', itemBefore);

    // Step 2: Count existing history records
    const { data: historyBefore, error: historyBeforeError } = await supabase
      .from('inventory_history')
      .select('*')
      .eq('inventory_id', inventory_id)
      .eq('business_id', business_id);

    if (historyBeforeError) {
      console.warn('Could not count history before:', historyBeforeError.message);
    }

    console.log(`📊 History records before: ${historyBefore?.length || 0}`);

    // Step 3: Make a small quantity change (add 1)
    const newQuantity = itemBefore.quantity + 1;
    const { data: itemAfter, error: updateError } = await supabase
      .from('inventory')
      .update({ quantity: newQuantity })
      .eq('id', inventory_id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ 
        error: 'Failed to update quantity',
        details: updateError.message
      });
    }

    console.log('📦 Item after:', itemAfter);

    // Step 4: Wait a moment for trigger to execute
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 5: Count history records after
    const { data: historyAfter, error: historyAfterError } = await supabase
      .from('inventory_history')
      .select('*')
      .eq('inventory_id', inventory_id)
      .eq('business_id', business_id)
      .order('created_at', { ascending: false });

    if (historyAfterError) {
      console.warn('Could not count history after:', historyAfterError.message);
    }

    console.log(`📊 History records after: ${historyAfter?.length || 0}`);

    // Step 6: Revert the change
    const { error: revertError } = await supabase
      .from('inventory')
      .update({ quantity: itemBefore.quantity })
      .eq('id', inventory_id);

    if (revertError) {
      console.warn('Could not revert quantity change:', revertError.message);
    }

    const result = {
      success: true,
      test_results: {
        item_name: itemBefore.name,
        quantity_before: itemBefore.quantity,
        quantity_after: itemAfter.quantity,
        history_records_before: historyBefore?.length || 0,
        history_records_after: historyAfter?.length || 0,
        new_history_created: (historyAfter?.length || 0) > (historyBefore?.length || 0),
        latest_history_record: historyAfter?.[0] || null
      }
    };

    console.log('✅ Test completed:', result);
    return res.status(200).json(result);

  } catch (error) {
    console.error('❌ Unexpected error in test-history-logging:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
};
