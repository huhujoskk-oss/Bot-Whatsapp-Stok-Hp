// src/config.js
// Konfigurasi terpusat, dibaca dari environment (.env).

require("dotenv").config();

function parseList(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((s) => s.trim().replace(/\D/g, "")) // simpan angka saja
    .filter(Boolean);
}

function parseStores(str) {
  if (!str) return ["Carpus", "Carten", "Kaba", "Pasar"];
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  // ID grup WhatsApp tempat bot beroperasi.
  // Formatnya seperti: 6281234567890-1600000000@g.us
  // Kosongkan dulu -> jalankan bot, ketik "#id" di grup untuk lihat ID-nya.
  GROUP_ID: process.env.GROUP_ID || "",

  // Nomor admin (boleh menambah/menghapus stok). Pisah dengan koma.
  // Contoh: ADMINS=6281234567890,628987654321
  ADMINS: parseList(process.env.ADMINS),

  // Prefix perintah teks.
  PREFIX: process.env.PREFIX || "#",

  // true  = ketik IMEI polos di grup -> langsung dicatat terjual.
  // false = penjualan hanya lewat perintah "#jual <imei>".
  AUTO_DETECT_IMEI: (process.env.AUTO_DETECT_IMEI || "true") === "true",

  // Kirim balasan konfirmasi ke grup setelah tiap transaksi.
  REPLY_IN_GROUP: (process.env.REPLY_IN_GROUP || "true") === "true",

  // Daftar nama toko/cabang yang valid untuk "#tambah". Pisah dengan koma.
  // Contoh: STORES=Carpus,Carten,Kaba,Pasar
  STORES: parseStores(process.env.STORES),
};
