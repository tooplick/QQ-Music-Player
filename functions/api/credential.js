/**
 * Cloudflare Pages Function - 凭证读取 API
 * GET /api/credential - 返回当前存储的凭证
 * 首次访问时自动从环境变量 INITIAL_CREDENTIAL 初始化
 */

/**
 * 确保表存在
 */
async function ensureCredential(db) {
    // 创建表
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

export async function onRequest(context) {
    const { request, env } = context;

    // CORS 预检
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });
    }

    if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }

    try {
        // 确保表存在
        await ensureCredential(env.DB);

        // 读取凭证
        const result = await env.DB.prepare(
            "SELECT * FROM credentials WHERE id = 1"
        ).first();

        if (!result) {
            return new Response(JSON.stringify({
                error: "No credential found.",
                credential: null
            }), {
                status: 404, // Not Found
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        // 构建凭证对象
        const credential = {
            openid: result.openid || "",
            refresh_token: result.refresh_token || "",
            access_token: result.access_token || "",
            expired_at: result.expired_at || 0,
            musicid: result.musicid || "",
            musickey: result.musickey || "",
            unionid: result.unionid || "",
            str_musicid: result.str_musicid || "",
            refresh_key: result.refresh_key || "",
            encrypt_uin: result.encrypt_uin || "",
            login_type: result.login_type || 2,
            extra_fields: {
                musickeyCreateTime: result.musickey_createtime || 0,
                keyExpiresIn: result.key_expires_in || 259200,
            },
        };

        return new Response(JSON.stringify({ credential }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });

    } catch (err) {
        console.error("读取凭证失败:", err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }
}
