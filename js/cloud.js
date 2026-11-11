import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const RPC_URL = SUPABASE_URL + '/rest/v1/rpc/';
const RPC_TIMEOUT_MS = 8000;

async function rpc(name, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
        const res = await fetch(RPC_URL + name, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_KEY,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        const text = await res.text();
        let data;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (e) {
                data = text;
            }
        }

        if (!res.ok) {
            const message = data && typeof data === 'object'
                ? (data.message || data.error_description || data.error)
                : data;
            throw new Error(message || 'Supabase RPC ' + name + ' failed (' + res.status + ')');
        }

        return data;
    } finally {
        clearTimeout(timer);
    }
}

export function fetchCheerState(broadcasterId) {
    return rpc('cheer_overlay_get', { p_broadcaster_id: broadcasterId });
}

export function saveCheerState(broadcasterId, cheerThreshold) {
    return rpc('cheer_overlay_save', {
        p_broadcaster_id: broadcasterId,
        p_cheer_threshold: cheerThreshold,
    });
}

// Ajustes por personaje de miguelium-wisdom (tabla propia, no toca a goal-overlay).
export function fetchCharacterState(broadcasterId) {
    return rpc('wisdom_characters_get', { p_broadcaster_id: broadcasterId });
}

export function saveCharacterState(broadcasterId, character, s) {
    return rpc('wisdom_characters_save', {
        p_broadcaster_id: broadcasterId,
        p_character: character,
        p_amount: s.amount,
        p_font: s.font,
        p_font_size: s.fontSize,
        p_movement: s.movement,
        p_palette: s.palette,
        p_flip: !!s.flip,
    });
}
