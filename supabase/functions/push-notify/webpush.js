// Web Push sender on plain Web Crypto: VAPID (RFC 8292) + aes128gcm message encryption (RFC 8291 / RFC 8188).
// No npm package: npm:web-push builds on Node's https/crypto (createECDH, createCipheriv), which the Supabase Edge
// Runtime only polyfills in part; this file uses crypto.subtle and fetch, which Deno and Node 20+ both have natively.
//
// Plain script for the same reason as events.js: `require` from Node tests, `import "./webpush.js"` from Deno
// (then globalThis.WebPush).
(function (root) {
  "use strict";
  const subtle = () => globalThis.crypto.subtle;
  const enc = new TextEncoder();

  function b64uToBytes(s) {
    const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const bin = atob(t + "===".slice((t.length + 3) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
  function bytesToB64u(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = ""; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };

  // VAPID keys as printed by `web-push generate-vapid-keys`: public = 65-byte uncompressed P-256 point, private = 32-byte d.
  async function importVapid(publicKeyB64u, privateKeyB64u) {
    const pub = b64uToBytes(publicKeyB64u), d = b64uToBytes(privateKeyB64u);
    if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error("VAPID keys must be a 65-byte public key and a 32-byte private key (base64url)");
    const jwk = { kty: "EC", crv: "P-256", x: bytesToB64u(pub.subarray(1, 33)), y: bytesToB64u(pub.subarray(33)), d: bytesToB64u(d), ext: true };
    const key = await subtle().importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return { key, publicKey: bytesToB64u(pub) };
  }

  // ES256 JWT for the push service of `endpoint`. JWS wants the raw r||s signature, which is what Web Crypto returns.
  async function vapidAuthorization(endpoint, vapid, subject, nowSeconds) {
    const aud = new URL(endpoint).origin, now = Math.floor(nowSeconds ?? Date.now() / 1000);
    const head = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const body = bytesToB64u(enc.encode(JSON.stringify({ aud, exp: now + 12 * 3600, sub: subject })));
    const sig = await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, vapid.key, enc.encode(`${head}.${body}`));
    return `vapid t=${head}.${body}.${bytesToB64u(new Uint8Array(sig))}, k=${vapid.publicKey}`;
  }

  async function hkdf(salt, ikm, info, bytes) {
    const k = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
  }

  // RFC 8291 section 3.4 + RFC 8188, one record. `testing` = { salt, serverKeys } only for known-answer tests.
  async function encrypt(plaintext, p256dhB64u, authB64u, testing) {
    const uaPublic = b64uToBytes(p256dhB64u), authSecret = b64uToBytes(authB64u);
    if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error("bad subscription keys");
    const serverKeys = testing?.serverKeys || await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const asPublic = new Uint8Array(await subtle().exportKey("raw", serverKeys.publicKey));
    const uaKey = await subtle().importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const ecdhSecret = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: uaKey }, serverKeys.privateKey, 256));
    const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
    const salt = testing?.salt || globalThis.crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
    const aes = await subtle().importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
    const data = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
    const cipher = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(data, new Uint8Array([2]))));
    const rs = 4096, header = new Uint8Array(21 + asPublic.length);
    header.set(salt, 0); new DataView(header.buffer).setUint32(16, rs); header[20] = asPublic.length; header.set(asPublic, 21);
    return concat(header, cipher);
  }

  // Only real browser push services, so a stored endpoint can never make the function POST somewhere else.
  const ENDPOINT_RE = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\/[\x21-\x7e]{1,900}$/;
  const endpointOk = e => typeof e === "string" && ENDPOINT_RE.test(e);

  // Sends one push. Resolves { status, gone } and never throws for HTTP errors; gone = 404/410 (subscription expired).
  async function send(sub, payload, opts) {
    if (!endpointOk(sub?.endpoint)) return { status: 0, gone: true, error: "endpoint not allowed" };
    const body = await encrypt(payload, sub.p256dh, sub.auth);
    const headers = {
      Authorization: await vapidAuthorization(sub.endpoint, opts.vapid, opts.subject),
      "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
      TTL: String(opts.ttl ?? 43200), Urgency: opts.urgency || "high"
    };
    // Topic: a newer push with the same topic replaces one still waiting on the push service (e.g. a corrected score).
    const topic = String(opts.topic || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
    if (topic) headers.Topic = topic;
    const doFetch = opts.fetch || globalThis.fetch;
    try {
      const res = await doFetch(sub.endpoint, { method: "POST", headers, body });
      let error = ""; if (!res.ok) { try { error = (await res.text()).slice(0, 200); } catch {} }
      return { status: res.status, gone: res.status === 404 || res.status === 410, error };
    } catch (e) {
      return { status: 0, gone: false, error: String(e?.message || e).slice(0, 200) };
    }
  }

  const api = Object.freeze({ b64uToBytes, bytesToB64u, importVapid, vapidAuthorization, encrypt, endpointOk, send });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WebPush = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
