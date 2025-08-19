import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Initializing inventory threshold tracking...');

    // Call the initialization function
    const { data: result, error } = await supabase
      .rpc('initialize_inventory_tracking');

    if (error) {
      console.error('❌ Error initializing tracking:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to initialize tracking',
        details: error.message
      });
    }

    console.log('✅ Initialization complete:', result);

    return res.status(200).json({
      success: true,
      message: 'Inventory tracking initialized successfully',
      result: result
    });

  } catch (error) {
    console.error('❌ Error in initialization:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
};
