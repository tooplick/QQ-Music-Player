/**
 * TripleDES decryption using CryptoJS and Pako
 * Replaces manual implementation for better reliability
 */

const KEY_STRING = "!@#)(*$%123ZXC!@!@#)(NHL";

export async function qrc_decrypt(encrypted_qrc_hex) {
    if (!encrypted_qrc_hex) return "";

    try {
        // 1. TripleDES Decrypt using CryptoJS
        // Input is Hex string
        // Key is Utf8 string (24 bytes)
        // Mode: ECB
        // Padding: Pkcs7 (Standard)

        if (typeof window.CryptoJS === 'undefined') {
            console.error('CryptoJS not loaded');
            return "";
        }

        const keyHex = window.CryptoJS.enc.Utf8.parse(KEY_STRING);
        const cipherParams = window.CryptoJS.lib.CipherParams.create({
            ciphertext: window.CryptoJS.enc.Hex.parse(encrypted_qrc_hex)
        });

        const decrypted = window.CryptoJS.TripleDES.decrypt(
            cipherParams,
            keyHex,
            {
                mode: window.CryptoJS.mode.ECB,
                padding: window.CryptoJS.pad.Pkcs7
            }
        );

        // Convert WordArray to Uint8Array
        const decryptedWords = decrypted.words;
        const sigBytes = decrypted.sigBytes;

        // Handle case where decryption failed silently (produced empty/garbage)
        if (sigBytes <= 0) {
            console.warn('Decryption produced empty result');
            return "";
        }

        const u8 = new Uint8Array(sigBytes);
        for (let i = 0; i < sigBytes; i++) {
            const byte = (decryptedWords[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
            u8[i] = byte;
        }

        // 2. Decompress using Pako (Inflate)
        // Pako handles Zlib headers (RFC 1950) automatically by default (inflate)
        // or Raw Deflate (inflateRaw).
        // Try standard inflate first.

        if (typeof window.pako === 'undefined') {
            // Fallback to Native logic if pako missing (but should be there)
            // ...
            console.error('Pako not loaded');
            return "";
        }

        try {
            // Try standard zlib inflate
            const result = window.pako.inflate(u8, { to: 'string' });
            return result;
        } catch (err) {
            // Try raw inflate
            // console.warn('Pako inflate failed, trying inflateRaw', err);
            try {
                const result = window.pako.inflateRaw(u8, { to: 'string' });
                return result;
            } catch (err2) {
                console.error('Pako decompression failed:', err2);
                return "";
            }
        }

    } catch (e) {
        console.error(`Frontend Decryption/Decompression failed: ${e}`);
        return "";
    }
}
