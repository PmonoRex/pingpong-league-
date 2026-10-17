// PromptPay (Thai QR Payment) payload builder: the EMVCo merchant-presented QR string that every Thai bank app scans.
// Pure functions, no DOM; promptpay.test.cjs checks the output against the reference promptpay-qr library.
const PromptPay = (() => {
  const GUID = "A000000677010111";
  const digits = value => String(value ?? "").replace(/\D/g, "");
  // Thai citizen ID: the 13th digit is a mod-11 check over the first 12.
  function citizenIdOk(id) {
    if (!/^\d{13}$/.test(id)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
    return (11 - sum % 11) % 10 === Number(id[12]);
  }
  // "phone" (10 digits starting 0), "id" (13-digit citizen ID) or "" when it is neither.
  function kind(value) {
    const d = digits(value);
    if (/^0\d{9}$/.test(d)) return "phone";
    if (citizenIdOk(d)) return "id";
    return "";
  }
  // Thai copy for the profile form; "" means the number can be saved.
  function problem(value) {
    const d = digits(value);
    if (!d) return "กรอกเบอร์มือถือหรือเลขบัตรประชาชน";
    if (d.length === 10) return d[0] === "0" ? "" : "เบอร์มือถือต้องขึ้นต้นด้วย 0";
    if (d.length === 13) return citizenIdOk(d) ? "" : "เลขบัตรประชาชนไม่ถูกต้อง (เช็คหลักสุดท้าย)";
    return "ใช้เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก";
  }
  // CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the ASCII payload, as EMVCo tag 63 requires.
  function crc16(text) {
    let crc = 0xffff;
    for (let i = 0; i < text.length; i++) {
      crc ^= text.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }
  const field = (id, value) => `${id}${String(value.length).padStart(2, "0")}${value}`;
  // Amounts are baht with 2 decimals; anything that is not a positive amount gives a QR where the payer types it.
  function amountText(amount) {
    const n = Math.round(Number(amount) * 100) / 100;
    return Number.isFinite(n) && n > 0 && n < 1e9 ? n.toFixed(2) : "";
  }
  function payload(target, amount) {
    const d = digits(target), type = kind(d);
    if (!type) return "";
    const account = type === "phone" ? `0066${d.slice(1)}` : d;
    const money = amountText(amount);
    const body = [
      field("00", "01"),
      field("01", money ? "12" : "11"),
      field("29", field("00", GUID) + field(type === "phone" ? "01" : "02", account)),
      field("58", "TH"),
      field("53", "764"),
      money ? field("54", money) : ""
    ].join("") + "6304";
    return body + crc16(body);
  }
  // For display: 081-234-5678 / 1-2345-67890-12-3.
  function format(value) {
    const d = digits(value), type = kind(d);
    if (type === "phone") return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    if (type === "id") return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
    return d;
  }
  return Object.freeze({ digits, kind, problem, crc16, payload, amountText, format, citizenIdOk });
})();
if (typeof window !== "undefined") window.PromptPay = PromptPay;
