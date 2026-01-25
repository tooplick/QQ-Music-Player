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
        dirid: 0,
        tag: 1,
        song_begin: 0,
        song_num: 150,
        userinfo: 1,
        orderlist: 1,
        onlysonglist: 0
    };

    const data = await apiRequest(
        'music.srfDissInfo.DissInfo',
        'CgiGetDiss',
        params
    );

    // Normalize result
    if (data && data.songlist) {
        return {
            info: data.dirinfo || {},
            songs: data.songlist
        };
    }

    throw new Error('Invalid playlist data');
}

/**
 * Get user created songlists
 * @param {string|number} uin - User QQ Number
 * @returns {Promise<Array>} - List of playlists
 */
export async function getUserSongLists(uin) {
    const params = {
        uin: String(uin)
    };

    const data = await apiRequest(
        'music.musicasset.PlaylistBaseRead',
        'GetPlaylistByUin',
        params
    );

    return data.v_playlist || [];
}

export default { getSongListDetail, getUserSongLists };
