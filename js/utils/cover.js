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
 * 参考 nekro 项目的验证方式：检查图片是否有效且尺寸合理
 */
function checkCoverValid(url, timeout = 5000) {
    return new Promise((resolve) => {
        if (!url) {
            resolve(false);
            return;
        }

        const img = new Image();
        let resolved = false;

        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                img.onload = null;
                img.onerror = null;
                img.src = '';
                resolve(false);
            }
        }, timeout);

        img.onload = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            // 验证图片尺寸：有效封面应该大于 50x50 像素
            // 无效封面可能返回小尺寸占位图
            const isValid = img.naturalWidth >= 50 && img.naturalHeight >= 50;
            resolve(isValid);
        };

        img.onerror = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            resolve(false);
        };

        // 设置 crossOrigin 以尝试加载跨域图片
        img.crossOrigin = 'anonymous';
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

    // 1. Try album_mid first (优先使用专辑封面)
    const albumMid = song?.album_mid || song?.album?.mid;
    if (albumMid) {
        const url = getCoverUrlByAlbumMid(albumMid, size);
        if (await checkCoverValid(url)) {
            return url;
        }
    }

    // 2. Try vs values (尝试 VS 值)
    const vsValues = song?.vs || [];
    if (Array.isArray(vsValues) && vsValues.length > 0) {
        // 收集候选VS值，单个值优先，逗号分隔的其次
        const candidates = [];

        // 2.1 收集单个VS值（优先级1）
        for (const vs of vsValues) {
            if (vs && typeof vs === 'string' && vs.length >= 3 && !vs.includes(',')) {
                candidates.push({ value: vs, priority: 1 });
            }
        }

        // 2.2 收集逗号分隔的VS值（优先级2）
        for (const vs of vsValues) {
            if (vs && typeof vs === 'string' && vs.includes(',')) {
                const parts = vs.split(',').map(p => p.trim()).filter(p => p.length >= 3);
                for (const part of parts) {
                    candidates.push({ value: part, priority: 2 });
                }
            }
        }

        // 按优先级排序
        candidates.sort((a, b) => a.priority - b.priority);

        // 逐个尝试
        for (const candidate of candidates) {
            const url = getCoverUrlByVs(candidate.value, size);
            if (await checkCoverValid(url)) {
                return url;
            }
        }
    }

    // 3. Return default cover
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

    // Try first non-empty single vs value (not comma-separated)
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

