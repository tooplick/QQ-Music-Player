/**
 * Admin 页面 - 凭证管理
 * GET /admin - 显示状态并自动尝试从外部 API 同步凭证
 */

/**
 * 解析凭证 JSON
 */
function parseCredential(data) {
    if (!data) return null;

    try {
        // 如果输入是字符串，尝试解析为对象
        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        // 解析 extra_fields
        let extraFields = {};
        if (typeof data.extra_fields === "string") {
            try {
                // 处理可能的 Python 风格单引号
                extraFields = JSON.parse(data.extra_fields.replace(/'/g, '"'));
            } catch (e) {
                console.warn("解析 extra_fields 失败:", e);
            }
        } else if (typeof data.extra_fields === "object") {
            extraFields = data.extra_fields;
        }

        return {
            openid: data.openid || "",
            refresh_token: data.refresh_token || "",
            access_token: data.access_token || "",
            expired_at: parseInt(data.expired_at) || 0,
            musicid: String(data.musicid || ""),
            musickey: data.musickey || "",
            unionid: data.unionid || "",
            str_musicid: data.str_musicid || "",
            refresh_key: data.refresh_key || "",
            encrypt_uin: data.encrypt_uin || "",
            login_type: parseInt(data.login_type) || 2,
            musickey_createtime: extraFields.musickeyCreateTime || 0,
            key_expires_in: extraFields.keyExpiresIn || 259200,
        };
    } catch (e) {
        console.error("解析凭证失败:", e);
        return null;
    }
}

/**
 * 确保凭证表存在
 */
async function ensureCredentialTable(db) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS credentials (
            id INTEGER PRIMARY KEY DEFAULT 1,
            openid TEXT,
            refresh_token TEXT,
            access_token TEXT,
            expired_at INTEGER,
            musicid TEXT,
            musickey TEXT,
            unionid TEXT,
            str_musicid TEXT,
            refresh_key TEXT,
            encrypt_uin TEXT,
            login_type INTEGER DEFAULT 2,
            musickey_createtime INTEGER,
            key_expires_in INTEGER DEFAULT 259200,
            updated_at INTEGER,
            CHECK (id = 1)
        )
    `).run();
}

/**
 * 保存凭证到数据库
 */
async function saveCredentialToDB(db, credential) {
    const now = Math.floor(Date.now() / 1000);

    // 检查是否存在
    const existing = await db.prepare("SELECT id FROM credentials WHERE id = 1").first();

    if (existing) {
        await db.prepare(`
            UPDATE credentials SET 
                openid = ?,
                refresh_token = ?,
                access_token = ?,
                expired_at = ?,
                musicid = ?,
                musickey = ?,
                unionid = ?,
                str_musicid = ?,
                refresh_key = ?,
                encrypt_uin = ?,
                login_type = ?,
                musickey_createtime = ?,
                key_expires_in = ?,
                updated_at = ?
            WHERE id = 1
        `).bind(
            credential.openid,
            credential.refresh_token,
            credential.access_token,
            credential.expired_at,
            credential.musicid,
            credential.musickey,
            credential.unionid,
            credential.str_musicid,
            credential.refresh_key,
            credential.encrypt_uin,
            credential.login_type,
            credential.musickey_createtime,
            credential.key_expires_in,
            now
        ).run();
    } else {
        await db.prepare(`
            INSERT INTO credentials (
                id, openid, refresh_token, access_token, expired_at,
                musicid, musickey, unionid, str_musicid, refresh_key,
                encrypt_uin, login_type, musickey_createtime, key_expires_in, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            credential.openid,
            credential.refresh_token,
            credential.access_token,
            credential.expired_at,
            credential.musicid,
            credential.musickey,
            credential.unionid,
            credential.str_musicid,
            credential.refresh_key,
            credential.encrypt_uin,
            credential.login_type,
            credential.musickey_createtime,
            credential.key_expires_in,
            now
        ).run();
    }
}

/**
 * 从数据库获取凭证
 */
async function getCredentialFromDB(db) {
    const result = await db.prepare(
        "SELECT * FROM credentials WHERE id = 1"
    ).first();

    if (!result) return null;

    return {
        musicid: result.musicid || "",
        // 仅返回需要的字段用于展示，如果需要完整字段可添加
        updated_at: result.updated_at
    };
}

export async function onRequest(context) {
    const { request, env } = context;

    // 检查数据库绑定
    if (!env.DB) {
        return new Response("Error: D1 database (DB) not bound.", { status: 500 });
    }

    let externalFetchStatus = "⚪ 未配置 EXTERNAL_API_URL，跳过外部获取";
    let dbStatus = "✅ 数据库连接正常";
    let initResult = "";

    try {
        await ensureCredentialTable(env.DB);

        // 1. 自动尝试从外部 API 获取凭证
        if (env.EXTERNAL_API_URL) {
            try {
                // 处理 URL 尾部斜杠并拼接 /api/credential
                const baseUrl = env.EXTERNAL_API_URL.endsWith('/')
                    ? env.EXTERNAL_API_URL.slice(0, -1)
                    : env.EXTERNAL_API_URL;
                // 强制拼接 /api/credential，因为根路径通常是主页 HTML
                const targetUrl = `${baseUrl}/api/credential`;

                console.log(`[Admin] Fetching credential from ${targetUrl}`);
                const resp = await fetch(targetUrl);

                if (resp.ok) {
                    const jsonData = await resp.json();

                    // 尝试解析数据 - 检查是否有 nested credential 字段 (API 通常返回 { code: 0, data: {...} } 或直接对象)
                    // 根据 qq-music-api 的实现，/api/credential 通常返回直接的凭证对象或 { data: credential }
                    let credentialData = jsonData;
                    if (jsonData.data) credentialData = jsonData.data;
                    if (jsonData.credential) credentialData = jsonData.credential;

                    const credential = parseCredential(credentialData);

                    if (credential && credential.musickey) {
                        await saveCredentialToDB(env.DB, credential);
                        externalFetchStatus = "✅ 通过外部 API 更新凭证成功";
                    } else {
                        externalFetchStatus = "❌ 外部 API 返回数据格式无效 (缺少 musickey)";
                        console.error("[Admin] Invalid data:", jsonData);
                    }
                } else {
                    externalFetchStatus = `❌ 外部 API 请求失败: ${resp.status} ${resp.statusText}`;
                    try {
                        const t = await resp.text();
                        console.error("[Admin] Error body:", t);
                    } catch (e) { }
                }
            } catch (e) {
                console.error("[Admin] Fetch error:", e);
                externalFetchStatus = `❌ 外部 API 请求错误: ${e.message}`;
            }
        }

        // 2. 获取当前数据库状态
        const currentParams = await getCredentialFromDB(env.DB);
        if (currentParams) {
            initResult = `当前 MusicID: ${currentParams.musicid}`;
            if (currentParams.updated_at) {
                const date = new Date(currentParams.updated_at * 1000);
                initResult += ` (最后更新: ${date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })})`;
            }
        } else {
            initResult = "⚠️ 数据库中暂无凭证";
        }

    } catch (err) {
        dbStatus = `❌ 数据库错误: ${err.message}`;
        console.error("[Admin] DB Error:", err);
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - QQ Music Player</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, sans-serif; background: #1a1a1a; color: #e0e0e0; min-height: 100vh; display: flex; justify-content: center; align-items: center; }
        .container { max-width: 600px; width: 100%; padding: 40px; }
        h1 { font-size: 1.5rem; margin-bottom: 30px; color: #fff; text-align: center; }
        .status { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
        .status-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #333; }
        .status-row:last-child { border: none; }
        .label { color: #888; }
        .value { font-family: monospace; text-align: right; }
        .result { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 20px; text-align: center; color: #31c27c; }
        a { color: #31c27c; text-decoration: none; display: inline-block; margin-top: 20px; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔧 Player Admin</h1>
        
        <div class="status">
            <div class="status-row">
                <span class="label">数据库状态</span>
                <span class="value">${dbStatus}</span>
            </div>
            <div class="status-row">
                <span class="label">外部同步</span>
                <span class="value">${externalFetchStatus}</span>
            </div>
        </div>
        
        <div class="result">
            <p>${initResult}</p>
        </div>
        
        <div style="text-align: center;">
            <p style="color: #666; font-size: 0.9rem;">
                访问此页面即会自动尝试从配置的外部 API 同步凭证。<br>
                API 地址: ${env.EXTERNAL_API_URL || '未配置'}
            </p>
            <a href="/">← 返回首页</a>
        </div>
    </div>
</body>
</html>`;

    return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
    });
}
