/**
 * Cover Image Utility
 * Fetches cover images with album_mid and vs value fallback
 */

const DEFAULT_COVER = 'https://y.gtimg.cn/music/photo_new/T002R800x800M000003y8dsH2wBHlo_1.jpg';

/**
 * Generate cover URL by album mid
 */
function getCoverUrlByAlbumMid(mid, size = 300) {
    if (!mid) return null;
    return `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${mid}.jpg`;
}

/**
 * Generate cover URL by vs value
 */
function getCoverUrlByVs(vs, size = 300) {
    if (!vs) return null;
    return `https://y.qq.com/music/photo_new/T062R${size}x${size}M000${vs}.jpg`;
}

/**
 * Check if cover URL is valid by loading image
 */
function checkCoverValid(url, timeout = 3000) {
    return new Promise((resolve) => {
        if (!url) {
            resolve(false);
            return;
        }

        const img = new Image();
        const timer = setTimeout(() => {
            img.onload = null;
            img.onerror = null;
            resolve(false);
        }, timeout);

        img.onload = () => {
            clearTimeout(timer);
            // Check if image is valid (not placeholder)
            resolve(img.naturalWidth > 10 && img.naturalHeight > 10);
        };

        img.onerror = () => {
            clearTimeout(timer);
            resolve(false);
        };

        img.src = url;
    });
}

/**
 * Get valid cover URL with fallback chain
 * @param {Object} song - Song data object
 * @param {number} size - Cover size (150, 300, 500, 800)
 * @returns {Promise<string>} Valid cover URL or default cover
 */
export async function getValidCoverUrl(song, size = 300) {
    // Validate size
    const validSizes = [150, 300, 500, 800];
    if (!validSizes.includes(size)) {
        size = 300;
    }

    // 1. Try album_mid first
    const albumMid = song?.album_mid || song?.album?.mid;
    if (albumMid) {
        const url = getCoverUrlByAlbumMid(albumMid, size);
        console.log('[Cover] Trying album_mid:', albumMid, url);
        if (await checkCoverValid(url)) {
            console.log('[Cover] album_mid valid');
            return url;
        }
    }

    // 2. Try vs values
    const vsValues = song?.vs || [];
    if (Array.isArray(vsValues) && vsValues.length > 0) {
        console.log('[Cover] Trying vs values:', vsValues.filter(v => v));

        // Filter and collect non-empty vs values
        const candidates = [];

        for (const vs of vsValues) {
            if (vs && typeof vs === 'string' && vs.length >= 3) {
                if (vs.includes(',')) {
                    // Comma-separated values
                    const parts = vs.split(',').map(p => p.trim()).filter(p => p.length >= 3);
                    candidates.push(...parts);
                } else {
                    candidates.push(vs);
                }
            }
        }

        // Try each candidate
        for (const candidate of candidates) {
            const url = getCoverUrlByVs(candidate, size);
            console.log('[Cover] Trying vs:', candidate, url);
            if (await checkCoverValid(url)) {
                console.log('[Cover] vs valid:', candidate);
                return url;
            }
        }
    }

    // 3. Return default cover
    console.log('[Cover] Using default cover');
    return DEFAULT_COVER.replace('R800x800', `R${size}x${size}`);
}

/**
 * Synchronous cover URL getter (no validation)
 * First tries album_mid, then first non-empty vs value
 */
export function getCoverUrlSync(song, size = 300) {
    // Try album_mid first
    const albumMid = song?.album_mid || song?.album?.mid;
    if (albumMid) {
        return getCoverUrlByAlbumMid(albumMid, size);
    }

    // Try first non-empty vs value
    const vsValues = song?.vs || [];
    if (Array.isArray(vsValues)) {
        for (const vs of vsValues) {
            if (vs && typeof vs === 'string' && vs.length >= 3 && !vs.includes(',')) {
                return getCoverUrlByVs(vs, size);
            }
        }
    }

    return DEFAULT_COVER.replace('R800x800', `R${size}x${size}`);
}

export { DEFAULT_COVER };
