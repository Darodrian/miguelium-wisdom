// Configuracion compartida entre el panel y el overlay.
// Usa el mismo proyecto Supabase que goal-overlay; el estado se clavea
// por broadcaster_id de Twitch en lugar de una clave secreta de sala.
export const SUPABASE_URL = 'https://jljzewyxrfwluulxlmmt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_elzdN-zBSd9k4-UDHZQztA_BHs5-WJc';

// Twitch app Client ID (publico, seguro en frontend).
export const TWITCH_CLIENT_ID = '8ogyj5yo3y71lsorrm94x2sop5prtx';

// Twitch OAuth Edge Function (el client secret se queda en el servidor).
export const TWITCH_OAUTH_BASE = 'https://jljzewyxrfwluulxlmmt.supabase.co/functions/v1/twitch-oauth';

export const amountDefault = 100;

export const cfg = {
  supabaseUrl: SUPABASE_URL,
  supabaseKey: SUPABASE_KEY,
  amountDefault,
};