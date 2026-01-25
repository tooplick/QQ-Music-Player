/**
 * QQ Music SongList API
 */

import { apiRequest } from './request.js';

/**
 * Get song list detail by id (disstid)
 * @param {string|number} disstid - Playlist ID (e.g., 8623138138)
 * @returns {Promise<Object>} - Playlist detail with song list
 */
export async function getSongListDetail(disstid) {
    const params = {
        disstid: Number(disstid),
        song_num: 150
    };

    const data = await apiRequest(
        'music.srfDissInfo.DissInfo',
        'CgiGetDiss',
        params
    );

    // Normalize result
    if (data && data.dirinfo && data.songlist) {
        return {
            info: data.dirinfo,
            songs: data.songlist
        };
    }

    throw new Error('Invalid playlist data');
}

export default { getSongListDetail };
