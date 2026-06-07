import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials not found in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSupabase() {
  console.log('Testing Supabase connection to:', supabaseUrl);
  try {
    // Attempt to query the interviews table or just get auth health
    const { data, error } = await supabase.from('interviews').select('id').limit(1);
    
    if (error) {
      console.error('Supabase query error:', error.message);
      process.exit(1);
    }
    
    console.log('Supabase connection successful!');
    console.log('Data returned:', data);
  } catch (err) {
    console.error('Unexpected error checking Supabase:', err);
    process.exit(1);
  }
}

checkSupabase();
