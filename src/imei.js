// src/imei.js
// Ekstraksi & validasi nomor IMEI dari teks yang diketik manual di grup.
//
// Prinsip: lebih baik TIDAK mendeteksi daripada salah mendeteksi.
// IMEI yang salah = unit yang salah ikut terjual. Jadi aturannya ketat:
// hanya blok angka yang berjumlah TEPAT 15 digit yang diterima.

/**
 * Validasi checksum IMEI dengan algoritma Luhn.
 * IMEI valid = 15 digit dan lolos Luhn.
 */
function isValidLuhn(imei) {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = parseInt(imei[i], 10);
    // Gandakan digit pada posisi index ganjil (0-based)
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// Tepat 15 digit berdiri sendiri (bukan potongan dari deret angka lebih panjang).
const RE_EXACT_15 = /(?<!\d)\d{15}(?!\d)/g;

// Blok angka dengan pemisah spasi/strip/titik DI DALAM satu baris.
// Sengaja TIDAK memakai \s agar tidak pernah menyambung antar baris.
const RE_SPACED = /\d(?:[ \-.]?\d){10,30}/g;

/**
 * Ekstrak semua IMEI (15 digit) dari sebuah pesan teks.
 * Mendukung:
 *   - "490154203237518"                (polos)
 *   - "terjual 490154203237518 an.Budi" (di tengah kalimat)
 *   - "49-0154-2032-37518"             (pakai strip)
 *   - "49 015420 323751 8"             (pakai spasi)
 *   - beberapa IMEI sekaligus (baris/koma/spasi terpisah)
 *
 * Menolak: nomor HP, harga, tanggal, dan deret angka yang bukan tepat 15 digit.
 * Mengembalikan array IMEI unik, urut sesuai kemunculan.
 */
function extractImeis(text) {
  if (!text) return [];

  const found = [];
  const seen = new Set();
  const push = (imei) => {
    if (!seen.has(imei)) {
      seen.add(imei);
      found.push(imei);
    }
  };

  // --- Tahap 1: IMEI utuh 15 digit tanpa pemisah ---
  // Ini menangani mayoritas kasus, termasuk beberapa IMEI dalam satu pesan.
  let masked = text.replace(RE_EXACT_15, (m) => {
    if (isValidLuhn(m)) {
      push(m);
      return " ".repeat(m.length); // tutup agar tidak diproses ulang di tahap 2
    }
    return m; // 15 digit tapi gagal Luhn -> biarkan, tetap tidak akan lolos
  });

  // --- Tahap 2: IMEI yang ditulis dengan pemisah, per baris ---
  for (const line of masked.split(/[\r\n]+/)) {
    for (const block of line.match(RE_SPACED) || []) {
      const digits = block.replace(/\D/g, "");
      // Hanya terima yang TEPAT 15 digit. Tidak ada jendela geser:
      // menebak-nebak substring berisiko menghasilkan IMEI hantu.
      if (digits.length === 15 && isValidLuhn(digits)) push(digits);
    }
  }

  return found;
}

/**
 * Bersihkan satu input IMEI (hapus spasi/strip/titik) lalu validasi.
 * Mengembalikan IMEI bersih (15 digit) atau null bila tidak valid.
 */
function normalizeImei(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length !== 15) return null;
  return isValidLuhn(digits) ? digits : null;
}

/**
 * Cek apakah teks mengandung minimal satu IMEI valid.
 */
function containsImei(text) {
  return extractImeis(text).length > 0;
}

module.exports = {
  isValidLuhn,
  extractImeis,
  normalizeImei,
  containsImei,
};
