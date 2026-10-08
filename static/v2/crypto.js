/* Futter v2 – Ende-zu-Ende-Verschlüsselung (WebCrypto, keine Fremdbibliothek).
 *
 * Link-Geheimnisse (32 Byte, base64url) stehen nur im Teil nach «#» und erreichen den Server nie.
 *   Bearbeiten-Link:  #s=<id>.w.<E>    E → R (Lese-Geheimnis), Schreib-Token
 *   Ansehen-Link:     #s=<id>.r.<R>    R → Schlüssel, Lese-Token
 * Der Server kennt nur SHA-256-Hashes der Tokens. Personenbezogene Felder werden mit
 * AES-256-GCM verschlüsselt; Bereich und Datensatz-ID sind als «additional data» gebunden,
 * damit verschlüsselte Pakete nicht zwischen Datensätzen vertauscht werden können.
 */
(function (global) {
  'use strict';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const SALT = enc.encode('agff-futter-v2');
  const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

  function b64u(bytes) {
    let s = ''; bytes = new Uint8Array(bytes);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const subtle = () => {
    if (!global.crypto || !global.crypto.subtle) throw new Error('Verschlüsselung nicht verfügbar (nur über HTTPS).');
    return global.crypto.subtle;
  };

  function newSecret() { return b64u(global.crypto.getRandomValues(new Uint8Array(32))); }

  async function hkdf(secretB64, info) {
    const base = await subtle().importKey('raw', unb64u(secretB64), 'HKDF', false, ['deriveBits']);
    const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) }, base, 256);
    return new Uint8Array(bits);
  }
  async function sha256hex(str) {
    const h = new Uint8Array(await subtle().digest('SHA-256', enc.encode(str)));
    return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Leitet alle Schlüssel aus einem Link-Geheimnis ab.
   * @returns {mode, readSecret, readToken, writeToken|null, key(CryptoKey)}
   */
  async function keys(mode, secret) {
    if (!SECRET_RE.test(secret || '') || (mode !== 'w' && mode !== 'r')) throw new Error('Ungültiger Schlüssel');
    const readSecret = mode === 'w' ? b64u(await hkdf(secret, 'read-secret')) : secret;
    const writeToken = mode === 'w' ? b64u(await hkdf(secret, 'auth-write')) : null;
    const readToken = b64u(await hkdf(readSecret, 'auth-read'));
    const key = await subtle().importKey('raw', await hkdf(readSecret, 'enc-aes-gcm'), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { mode, readSecret, readToken, writeToken, key };
  }
  /** Hashes für den Server (Anlegen / Erneuern). */
  async function hashes(k) { return { readHash: await sha256hex(k.readToken), writeHash: await sha256hex(k.writeToken) }; }

  async function encryptJSON(key, obj, aad) {
    const iv = global.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(obj)));
    return { v: 1, iv: b64u(iv), ct: b64u(ct) };
  }
  async function decryptJSON(key, box, aad) {
    if (!box) return {};
    if (box.v !== 1) throw new Error('Unbekannte Verschlüsselungsversion');
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(box.iv), additionalData: enc.encode(aad) }, key, unb64u(box.ct));
    return JSON.parse(dec.decode(pt));
  }
  const aadFor = (spaceId, recordId) => 'agff-futter-v2|' + spaceId + '|' + recordId;

  /** Link-Teil nach «#s=» zerlegen: "<id>.<w|r>.<secret>" */
  function parseLink(token) {
    const m = /^([A-Za-z0-9_-]{6,64})\.(w|r)\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
    return m ? { id: m[1], mode: m[2], secret: m[3] } : null;
  }

  global.FutterCrypto = { newSecret, keys, hashes, encryptJSON, decryptJSON, aadFor, parseLink, SECRET_RE };
})(typeof window !== 'undefined' ? window : globalThis);
