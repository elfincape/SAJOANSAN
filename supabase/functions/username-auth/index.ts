import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { makeHandler } from './handler.js';
Deno.serve(makeHandler(Deno.env.toObject(),createClient));
