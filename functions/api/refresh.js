/**
 * Cloudflare Pages Function - Cron 定时刷新凭证
 * 每小时执行一次，检查凭证是否即将过期，自动刷新
 */

// QQ 音乐 API 配置
const API_CONFIG = {
    version: "13.2.5.8",
    versionCode: 13020508,
    endpoint: "https://u.y.qq.com/cgi-bin/musics.fcg",
};

/**
 * SHA1 哈希 (Web Crypto API)
 */
async function sha1(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * 生成请求签名
 */
async function generateSign(requestData) {
    const jsonStr = JSON.stringify(requestData);
    const hash = await sha1(jsonStr);

    const part1Indexes = [23, 14, 6, 36, 16, 40, 7, 19].filter(x => x < 40);
    const part1 = part1Indexes.map(i => hash[i] || '').join('');

    const part2Indexes = [16, 1, 32, 12, 19, 27, 8, 5];
    const part2 = part2Indexes.map(i => hash[i] || '').join('');

    const scrambleValues = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
    const part3Bytes = new Uint8Array(20);
    for (let i = 0; i < scrambleValues.length; i++) {
        const hexValue = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
        part3Bytes[i] = scrambleValues[i] ^ hexValue;
    }

    let b64Part = btoa(String.fromCharCode(...part3Bytes));
    b64Part = b64Part.replace(/[\\/+=]/g, '');

    return `zzc${part1}${b64Part}${part2}`.toLowerCase();
}

/**
 * 构建通用请求参数
 */
function buildCommonParams(credential) {
    return {
        cv: API_CONFIG.versionCode,
        v: API_CONFIG.versionCode,
        QIMEI36: "8888888888888888",
        ct: "11",
        tmeAppID: "qqmusic",
        format: "json",
        inCharset: "utf-8",
        outCharset: "utf-8",
        uid: "3931641530",
        qq: String(credential.musicid),
        authst: credential.musickey,
        tmeLoginType: String(credential.login_type || 2),
    };
}

/**
 * 构建 Cookie 字符串
 */
function buildCookies(credential) {
    return [
        `uin=${credential.musicid}`,
        `qqmusic_key=${credential.musickey}`,
        `qm_keyst=${credential.musickey}`,
        `tmeLoginType=${credential.login_type || 2}`,
    ].join("; ");
}

/**
 * 刷新凭证
 */
async function refreshCredential(credential) {
    if (!credential.refresh_key) {
        throw new Error("缺少 refresh_key");
    }

    const params = {
        refresh_key: credential.refresh_key,
        refresh_token: credential.refresh_token,
        musickey: credential.musickey,
        musicid: credential.musicid,
    };

    const common = buildCommonParams(credential);
    const requestData = {
        comm: common,
        "music.login.LoginServer.Login": {
            module: "music.login.LoginServer",
            method: "Login",
            param: params,
        },
    };

    const signature = await generateSign(requestData);
    const url = `${API_CONFIG.endpoint}?sign=${signature}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Referer": "https://y.qq.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Origin": "https://y.qq.com",
            "Cookie": buildCookies(credential),
        },
        body: JSON.stringify(requestData),
    });

    const data = await response.json();
    const result = data["music.login.LoginServer.Login"];

    if (!result || result.code !== 0) {
        throw new Error(`刷新失败: code=${result?.code}`);
    }

    return result.data;
}

/**
 * Cron 触发器入口
 */
export async function onSchedule(context) {
    const { env } = context;

    try {
        console.log("[Cron] 开始检查凭证状态...");

        // 读取当前凭证
        const row = await env.DB.prepare(
            "SELECT * FROM credentials WHERE id = 1"
        ).first();

        if (!row) {
            console.log("[Cron] 未找到凭证，跳过");
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        const createTime = row.musickey_createtime || 0;
        const expiresIn = row.key_expires_in || 259200;
        const expireTime = createTime + expiresIn;
        const remainingTime = expireTime - now;

        console.log(`[Cron] 凭证剩余有效期: ${Math.floor(remainingTime / 3600)} 小时`);

        // 如果剩余时间少于 24 小时，刷新凭证
        if (remainingTime < 24 * 3600) {
            console.log("[Cron] 凭证即将过期，开始刷新...");

            const credential = {
                musicid: row.musicid,
                musickey: row.musickey,
                refresh_key: row.refresh_key,
                refresh_token: row.refresh_token,
                login_type: row.login_type,
            };

            const newData = await refreshCredential(credential);

            // 更新数据库
            await env.DB.prepare(`
                UPDATE credentials SET 
                    musickey = ?,
                    musicid = ?,
                    refresh_key = ?,
                    refresh_token = ?,
                    musickey_createtime = ?,
                    key_expires_in = ?,
                    updated_at = ?
                WHERE id = 1
            `).bind(
                newData.musickey || row.musickey,
                newData.musicid || row.musicid,
                newData.refresh_key || row.refresh_key,
                newData.refresh_token || row.refresh_token,
                now,
                newData.keyExpiresIn || 259200,
                now
            ).run();

            console.log("[Cron] 凭证刷新成功");
        } else {
            console.log("[Cron] 凭证有效期充足，无需刷新");
        }

    } catch (err) {
        console.error("[Cron] 刷新凭证失败:", err);
    }
}

/**
 * HTTP 触发器（用于手动测试）
 * POST /api/refresh - 手动触发刷新
 */
export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });
    }

    if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }

    try {
        await onSchedule(context);

        return new Response(JSON.stringify({ success: true, message: "刷新完成" }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }
}
