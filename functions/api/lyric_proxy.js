/**
 * Cloudflare Pages Function for Lyric Proxy
 * Handles decryption of QRC lyrics
 */

import { qrc_decrypt } from '../tripledes.js';

export async function onRequest(context) {
    const { request } = context;

    // Handle options
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, X-Proxy-Cookie",
            },
        });
    }

    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        const url = new URL(request.url);
        const sign = url.searchParams.get("sign");
        let targetUrl = "https://u.y.qq.com/cgi-bin/musics.fcg";

        if (sign) {
            targetUrl += `?sign=${sign}`;
        }

        const body = await request.text();

        const headers = {
            "Content-Type": "application/json",
            "Referer": "https://y.qq.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Origin": "https://y.qq.com"
        };

        const proxyCookie = request.headers.get("X-Proxy-Cookie");
        if (proxyCookie) {
            headers["Cookie"] = proxyCookie;
        }

        // Forward request
        const response = await fetch(targetUrl, {
            method: "POST",
            headers: headers,
            body: body
        });

        const responseData = await response.json();

        // Decrypt Logic
        try {
            // Find lyric data
            // Typical key structure: music.musichallSong.PlayLyricInfo.GetPlayLyricInfo
            let dataObj = null;
            if (responseData['music.musichallSong.PlayLyricInfo.GetPlayLyricInfo']) {
                dataObj = responseData['music.musichallSong.PlayLyricInfo.GetPlayLyricInfo'].data;
            }

            if (dataObj) {
                if (dataObj.lyric) {
                    dataObj.lyric = await qrc_decrypt(dataObj.lyric);
                }
                if (dataObj.trans) {
                    dataObj.trans = await qrc_decrypt(dataObj.trans);
                }
                if (dataObj.roma) {
                    dataObj.roma = await qrc_decrypt(dataObj.roma);
                }
            }
        } catch (decryptErr) {
            console.error("Decryption failed:", decryptErr);
            // Continue without decryption if failed (or partial)
        }

        // Return modified response
        return new Response(JSON.stringify(responseData), {
            status: response.status,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, X-Proxy-Cookie",
                "X-Decrypt-Status": "Attempted" // Debug header
            },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }
}
