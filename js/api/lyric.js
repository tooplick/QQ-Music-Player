/**
 * QQ Music Lyric API
 */

import { qrc_decrypt } from '../utils/tripledes.js';
import { apiRequest } from './request.js';

// ... (retain decryptLyric function if needed, but we rely on qrc_decrypt)

/**
 * Get song lyrics
 * @param {string|number} value - Song mid or id
 * @param {Object} options - Options { trans: boolean, roma: boolean }
 * @returns {Promise<Object>} - { lyric, trans, roma }
 */
export async function getLyric(value, options = {}) {
    const { trans = true, roma = false } = options;

    const params = {
        crypt: 1, // Enable crypt
        ct: 11,
        cv: 13020508,
        lrc_t: 0,
        qrc: 0,
        qrc_t: 0,
        roma: roma ? 1 : 0,
        roma_t: 0,
        trans: trans ? 1 : 0,
        trans_t: 0,
        type: 1
    };

    if (typeof value === 'number') {
        params.songId = value;
    } else {
        params.songMid = value;
    }

    // Use proxy endpoint
    const result = await apiRequest(
        'music.musichallSong.PlayLyricInfo',
        'GetPlayLyricInfo',
        params,
        { endpoint: '/lyric_proxy' }
    );

    // Frontend decryption
    // result contains encrypted hexdump in lyric/trans/roma fields
    let lyricText = result.lyric || '';
    let transText = result.trans || '';
    let romaText = result.roma || '';

    try {
        if (lyricText && !lyricText.startsWith('[')) {
            const decrypted = await qrc_decrypt(lyricText);
            if (decrypted) lyricText = decrypted;
        }
        if (transText && !transText.startsWith('[')) {
            const decrypted = await qrc_decrypt(transText);
            if (decrypted) transText = decrypted;
        }
        if (romaText && !romaText.startsWith('[')) {
            const decrypted = await qrc_decrypt(romaText);
            if (decrypted) romaText = decrypted;
        }
    } catch (e) {
        console.error('Frontend decryption failed:', e);
    }

    return {
        lyric: lyricText,
        trans: transText,
        roma: romaText
    };
}

export default { getLyric };
