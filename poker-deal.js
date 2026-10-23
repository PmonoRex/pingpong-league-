// แจกในแอป (poker.html): the app shuffles and deals. Each player's phone holds its own key pair (ECDH P-256); the phone
// that deals encrypts every player's two hole cards to that player's public key (AES-GCM with a one-off ECDH key), so
// the shared row only ever holds sealed boxes. The rest of the deck stays on the dealing phone, which turns the board
// over street by street. That phone shuffled, so it could know the cards: friends' game, same trust as the rest.
const PokerDeal = (() => {
  const subtle = () => globalThis.crypto?.subtle;
  const b64 = buf => { let s = ""; new Uint8Array(buf).forEach(x => { s += String.fromCharCode(x); }); return btoa(s); };
  const unb64 = str => Uint8Array.from(atob(str), ch => ch.charCodeAt(0));
  const ECDH = { name: "ECDH", namedCurve: "P-256" };
  const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

  // Unbiased Fisher-Yates over 52 cards with the browser's secure random numbers.
  function shuffle(random = n => { const max = Math.floor(0x100000000 / n) * n, buf = new Uint32Array(1); do { globalThis.crypto.getRandomValues(buf); } while (buf[0] >= max); return buf[0] % n; }) {
    const deck = Array.from({ length: 52 }, (_, c) => c);
    for (let i = deck.length - 1; i > 0; i--) { const j = random(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return deck;
  }
  async function newKeys() {
    const pair = await subtle().generateKey(ECDH, true, ["deriveKey"]);
    return { pub: b64(await subtle().exportKey("raw", pair.publicKey)), priv: await subtle().exportKey("jwk", pair.privateKey) };
  }
  const importPub = pub => subtle().importKey("raw", unb64(pub), ECDH, false, []);
  const importPriv = jwk => subtle().importKey("jwk", jwk, ECDH, false, ["deriveKey"]);
  const aes = (priv, pub, use) => subtle().deriveKey({ name: "ECDH", public: pub }, priv, { name: "AES-GCM", length: 256 }, false, [use]);
  // One deal: a fresh ECDH key for the dealing phone, then one sealed box per player: { iv, ct } in base64.
  async function seal(recipients, hands) {
    const eph = await subtle().generateKey(ECDH, true, ["deriveKey"]), boxes = {};
    for (const [name, pub] of Object.entries(recipients)) {
      const key = await aes(eph.privateKey, await importPub(pub), "encrypt"), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(hands[name])));
      boxes[name] = { iv: b64(iv), ct: b64(ct) };
    }
    return { epk: b64(await subtle().exportKey("raw", eph.publicKey)), boxes };
  }
  // My two cards from my box, or null if it was not sealed to this phone's key.
  async function open(privJwk, epk, box) {
    try {
      const key = await aes(await importPriv(privJwk), await importPub(epk), "decrypt");
      const cards = JSON.parse(new TextDecoder().decode(await subtle().decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct))));
      return Array.isArray(cards) && cards.length === 2 && cards.every(c => Number.isInteger(c) && c >= 0 && c < 52) && cards[0] !== cards[1] ? cards : null;
    } catch { return null; }
  }
  const validB64 = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && B64.test(v);

  // ---- this phone: its key pair, the decks it dealt, the hole cards it opened ----
  const KEY = "pp_poker_key_v1", DECKS = "pp_poker_decks_v1", MINE = "pp_poker_mine_v1";
  const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? fallback; } catch { return fallback; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let keys = null;
  async function myKeys() { if (keys) return keys; keys = read(KEY, null); if (!keys?.pub || !keys?.priv) { keys = await newKeys(); write(KEY, keys); } return keys; }
  const myPub = () => (keys || read(KEY, null))?.pub || null;
  // Only the last few hands are worth keeping.
  function keepLast(map, n = 6) { return Object.fromEntries(Object.entries(map).slice(-n)); }
  const saveBoard = (handId, board) => write(DECKS, keepLast({ ...read(DECKS, {}), [handId]: board }));
  const boardFor = handId => read(DECKS, {})[handId] || null;
  const opened = {};
  const myCards = handId => opened[handId] || read(MINE, {})[handId] || null;
  async function unlock(handId, epk, box) {
    if (myCards(handId)) return myCards(handId);
    const k = await myKeys(), cards = await open(k.priv, epk, box);
    if (cards) { opened[handId] = cards; write(MINE, keepLast({ ...read(MINE, {}), [handId]: cards })); }
    return cards;
  }
  return Object.freeze({ shuffle, newKeys, seal, open, validB64, myKeys, myPub, saveBoard, boardFor, myCards, unlock });
})();
if (typeof window !== "undefined") window.PokerDeal = PokerDeal;
