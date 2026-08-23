// src/sales.js
// Logika penjualan bersama, dipakai oleh perintah #jual maupun deteksi IMEI otomatis.

const db = require("./database");

/**
 * Proses sekumpulan IMEI sebagai penjualan.
 * @param {string[]} imeis
 * @param {string} soldBy  nomor pengirim
 * @returns {{sold: Array, alreadySold: Array, notFound: string[]}}
 */
function processSale(imeis, soldBy) {
  const sold = [];
  const alreadySold = [];
  const notFound = [];

  for (const imei of imeis) {
    const r = db.sellUnit(imei, soldBy);
    if (r.ok) {
      sold.push({ imei, model: r.model.name, toko: r.toko, warna: r.warna, remaining: r.remaining });
    } else if (r.reason === "already_sold") {
      alreadySold.push({ imei, model: r.model.name });
    } else {
      notFound.push(imei);
    }
  }

  return { sold, alreadySold, notFound };
}

/**
 * Susun pesan balasan untuk grup dari hasil processSale.
 * @param {object} result hasil processSale
 * @param {string} prefix prefix perintah (untuk petunjuk)
 * @returns {string}
 */
function formatSaleReply(result, prefix = "#") {
  const { sold, alreadySold, notFound } = result;
  const parts = [];

  if (sold.length) {
    // Sisa stok per model dihitung ulang agar akurat saat beberapa unit
    // dari model yang sama terjual dalam satu pesan.
    const lines = sold.map(
      (s) => `• ${s.model}${s.warna ? ` (${s.warna})` : ""}\n  Toko: ${s.toko || "-"}\n  IMEI: ${s.imei}`
    );
    parts.push(`🔻 *TERJUAL* (${sold.length} unit)\n\n${lines.join("\n")}`);

    const models = [...new Set(sold.map((s) => s.model))];
    const sisa = models.map((m) => {
      const cur = db.stockForModel(m);
      return `• ${m}: *${cur ? cur.total : 0}* unit`;
    });
    parts.push(`📦 *Sisa stok:*\n${sisa.join("\n")}`);
  }

  if (alreadySold.length) {
    const lines = alreadySold.map((s) => `• ${s.imei} (${s.model})`);
    parts.push(`⚠️ *Sudah terjual sebelumnya:*\n${lines.join("\n")}`);
  }

  if (notFound.length) {
    const lines = notFound.map((i) => `• ${i}`);
    parts.push(
      `❓ *Tidak ada di stok:*\n${lines.join("\n")}\n` +
        `_Tambahkan dulu: ${prefix}tambah <imei> <toko>/<model>/<warna>_`
    );
  }

  return parts.join("\n\n");
}

module.exports = { processSale, formatSaleReply };
