// src/commands.js
// Penanganan perintah teks. Fungsi murni: input teks + konteks -> string balasan.

const db = require("./database");
const { normalizeImei, extractImeis } = require("./imei");
const { processSale, formatSaleReply } = require("./sales");

function isAdmin(sender, admins) {
  const num = String(sender || "").replace(/\D/g, "");
  return admins.includes(num);
}

function fmtStockSummary() {
  const rows = db.stockSummary();
  if (!rows.length) return "📦 Belum ada data stok.";

  const byToko = new Map();
  let total = 0;
  for (const r of rows) {
    total += r.available;
    if (!byToko.has(r.toko)) byToko.set(r.toko, []);
    byToko.get(r.toko).push(r);
  }

  const blocks = [...byToko.entries()].map(([toko, items]) => {
    const lines = items.map((r) => `• ${r.model} (${r.warna}): *${r.available}* unit`);
    return `🏬 *${toko}*\n${lines.join("\n")}`;
  });

  return `📦 *STOK VIVO SAAT INI*\n\n${blocks.join("\n\n")}\n\n*Total: ${total} unit*`;
}

function fmtModelDetail(res) {
  const lines = res.rows.map((r) => `• ${r.toko} - ${r.warna}: *${r.available}* unit`);
  return `📦 *${res.model}*\n\n${lines.join("\n")}\n\n*Total: ${res.total} unit*`;
}

function fmtStoreDetail(res) {
  const lines = res.rows.map((r) => `• ${r.model} (${r.warna}): *${r.available}* unit`);
  return `📦 *Stok Toko ${res.toko}*\n\n${lines.join("\n")}\n\n*Total: ${res.total} unit*`;
}

function fmtStockDetailed(rows, title) {
  if (!rows.length) return "📦 Belum ada data stok.";

  const byToko = new Map();
  let total = 0;
  for (const r of rows) {
    total += 1;
    if (!byToko.has(r.toko)) byToko.set(r.toko, new Map());
    const models = byToko.get(r.toko);
    const key = `${r.model} (${r.warna})`;
    if (!models.has(key)) models.set(key, []);
    models.get(key).push(r.imei);
  }

  const blocks = [...byToko.entries()].map(([toko, models]) => {
    const modelLines = [...models.entries()].map(([key, imeis]) => {
      const imeiLines = imeis.map((imei, i) => `   ${i + 1}. ${imei}`).join("\n");
      return `• ${key} — *${imeis.length}* unit\n${imeiLines}`;
    });
    return `🏬 *${toko}*\n${modelLines.join("\n")}`;
  });

  return `📦 *${title}*\n\n${blocks.join("\n\n")}\n\n*Total: ${total} unit*`;
}

/**
 * @param {string} body  isi pesan teks
 * @param {object} ctx   { sender, chatId, config }
 * @returns {string|null}  balasan, atau null jika bukan perintah
 */
function handleCommand(body, ctx) {
  const { config } = ctx;
  const prefix = config.PREFIX;
  if (!body || !body.startsWith(prefix)) return null;

  const withoutPrefix = body.slice(prefix.length).trim();
  const [cmdRaw, ...rest] = withoutPrefix.split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  const argStr = rest.join(" ").trim();
  const admin = isAdmin(ctx.sender, config.ADMINS);

  switch (cmd) {
    case "stok":
    case "stock": {
      if (!argStr) return fmtStockSummary();

      const storeMatch = config.STORES.find((s) => s.toLowerCase() === argStr.toLowerCase());
      if (storeMatch) {
        const res = db.stockForStore(storeMatch);
        if (!res.rows.length) return `📦 Belum ada stok di toko *${storeMatch}*.`;
        return fmtStoreDetail(res);
      }

      const res = db.stockForModel(argStr);
      if (!res) return `❓ Model "${argStr}" belum terdaftar.`;
      if (!res.rows.length) return `📦 *${res.model}*: stok kosong.`;
      return fmtModelDetail(res);
    }

    case "stokdetail":
    case "stoklengkap":
    case "detailstok": {
      if (!argStr) {
        const rows = db.stockDetailed();
        return fmtStockDetailed(rows, "STOK LENGKAP (SEMUA)");
      }

      const storeMatch = config.STORES.find((s) => s.toLowerCase() === argStr.toLowerCase());
      if (storeMatch) {
        const rows = db.stockDetailed({ toko: storeMatch });
        if (!rows.length) return `📦 Belum ada stok di toko *${storeMatch}*.`;
        return fmtStockDetailed(rows, `STOK LENGKAP — TOKO ${storeMatch}`);
      }

      const model = db.findModelByName(argStr);
      if (!model) return `❓ Model "${argStr}" belum terdaftar.`;
      const rows = db.stockDetailed({ modelName: model.name });
      if (!rows.length) return `📦 *${model.name}*: stok kosong.`;
      return fmtStockDetailed(rows, `STOK LENGKAP — ${model.name.toUpperCase()}`);
    }

    case "tambah":
    case "add": {
      if (!admin) return `⛔ Hanya admin yang boleh menambah stok. (Nomor terdeteksi: ${ctx.sender})`;
      // Format per unit: <imei> <toko>/<model>/<warna>
      // Bisa satu unit (di baris yang sama dengan perintah), atau banyak
      // sekaligus dengan satu unit per baris (boleh beda toko/model/warna
      // di tiap baris, mis. kedatangan barang campur beberapa tipe).
      const contoh = `${prefix}tambah 490154203237518 Carpus/Y05 4/128/Hitam`;
      const rawLines = withoutPrefix.split(/\r?\n/);
      const firstLineRest = rawLines[0].replace(/^\S+\s*/, "").trim();
      const entries = [firstLineRest, ...rawLines.slice(1).map((l) => l.trim())].filter(Boolean);

      if (!entries.length) {
        return (
          `⚠️ Format salah. Gunakan:\n${prefix}tambah <imei> <toko>/<model>[ RAM]/<warna>\n\n` +
          `Contoh:\n${contoh}\n\nToko yang tersedia: ${config.STORES.join(", ")}\n\n` +
          `Bisa juga banyak unit sekaligus (beda model/warna pun boleh), satu baris per unit.`
        );
      }

      const okList = [];
      const failList = [];

      for (const entry of entries) {
        const spaceIdx = entry.indexOf(" ");
        const imeiRaw = spaceIdx === -1 ? entry : entry.slice(0, spaceIdx);
        const rest = spaceIdx === -1 ? "" : entry.slice(spaceIdx + 1).trim();
        const imei = normalizeImei(imeiRaw);
        if (!imei) {
          failList.push(`⚠️ "${imeiRaw}" — IMEI tidak valid`);
          continue;
        }

        // Model boleh mengandung "/" (mis. RAM "4/128"), jadi toko = segmen
        // pertama, warna = segmen terakhir, sisanya di tengah disatukan lagi
        // sebagai nama model (termasuk RAM-nya).
        const segs = rest.split("/").map((s) => s.trim());
        if (segs.length < 3 || segs.some((s) => !s)) {
          failList.push(`⚠️ ${imei} — format salah, butuh <toko>/<model>/<warna>`);
          continue;
        }

        const tokoRaw = segs[0];
        const warna = segs[segs.length - 1];
        const model = segs.slice(1, -1).join("/");
        const toko = config.STORES.find((s) => s.toLowerCase() === tokoRaw.toLowerCase());
        if (!toko) {
          failList.push(`⚠️ ${imei} — toko "${tokoRaw}" tidak dikenal`);
          continue;
        }

        const r = db.addUnit(imei, model, toko, warna, ctx.sender);
        if (!r.ok) {
          failList.push(`⚠️ ${imei} — sudah terdaftar (status: ${r.status})`);
          continue;
        }
        okList.push({ imei, model, toko, warna });
      }

      // Input tunggal: pertahankan balasan detail seperti sebelumnya.
      if (entries.length === 1 && okList.length === 1) {
        const { imei, model, toko, warna } = okList[0];
        const s = db.stockForModel(model);
        const diTokoIni = s.rows.find((row) => row.toko === toko && row.warna === warna);
        return (
          `✅ Ditambahkan: *${model}* (${warna})\nToko: ${toko}\nIMEI: ${imei}\n` +
          `Stok ${model} (${warna}) di ${toko}: *${diTokoIni ? diTokoIni.available : 1}* unit.`
        );
      }

      const lines = [];
      if (okList.length) {
        lines.push(`✅ *${okList.length} unit ditambahkan:*`);
        for (const o of okList) lines.push(`• ${o.model} (${o.warna}) — ${o.toko} — ${o.imei}`);
      }
      if (failList.length) {
        if (lines.length) lines.push("");
        lines.push(`❌ *${failList.length} gagal:*`);
        lines.push(...failList);
      }
      return lines.join("\n");
    }

    case "pindah":
    case "move": {
      if (!admin) return `⛔ Hanya admin yang boleh memindahkan stok. (Nomor terdeteksi: ${ctx.sender})`;
      // Format: #pindah <imei> <toko_tujuan>
      const spaceIdx = argStr.indexOf(" ");
      const imeiRaw = spaceIdx === -1 ? argStr : argStr.slice(0, spaceIdx);
      const tokoTujuanRaw = spaceIdx === -1 ? "" : argStr.slice(spaceIdx + 1).trim();
      const imei = normalizeImei(imeiRaw);
      const contoh = `${prefix}pindah 490154203237518 Carpus`;
      if (!imei || !tokoTujuanRaw) {
        return (
          `⚠️ Format salah. Gunakan:\n${prefix}pindah <imei> <toko_tujuan>\n\n` +
          `Contoh:\n${contoh}\n\nToko yang tersedia: ${config.STORES.join(", ")}`
        );
      }

      const toko = config.STORES.find((s) => s.toLowerCase() === tokoTujuanRaw.toLowerCase());
      if (!toko) {
        return `⚠️ Toko "${tokoTujuanRaw}" tidak dikenal. Pilihan: ${config.STORES.join(", ")}`;
      }

      const r = db.moveUnit(imei, toko);
      if (!r.ok) {
        if (r.reason === "not_found") return `❓ IMEI ${imei} tidak ditemukan.`;
        if (r.reason === "not_available") return `⚠️ IMEI ${imei} sudah tidak tersedia (status: ${r.status}).`;
        if (r.reason === "same_store") return `⚠️ IMEI ${imei} sudah berada di toko *${toko}*.`;
      }
      return (
        `🔀 Dipindahkan: *${r.model}* (${r.warna})\nIMEI: ${imei}\n` +
        `${r.fromToko || "(belum diisi)"} → *${r.toToko}*`
      );
    }

    case "hapus":
    case "remove": {
      if (!admin) return `⛔ Hanya admin yang boleh menghapus stok. (Nomor terdeteksi: ${ctx.sender})`;
      const imei = normalizeImei(argStr);
      if (!imei) return `⚠️ IMEI tidak valid. Contoh:\n${prefix}hapus 490154203237518`;
      const r = db.removeUnit(imei);
      return r.ok ? `🗑️ IMEI ${imei} dihapus dari database.` : `❓ IMEI ${imei} tidak ditemukan.`;
    }

    case "jual":
    case "sell": {
      // Mendukung satu atau banyak IMEI sekaligus.
      const imeis = extractImeis(argStr);
      if (!imeis.length) {
        return (
          `⚠️ Tidak ada IMEI valid. Contoh:\n${prefix}jual 490154203237518\n\n` +
          `Bisa juga beberapa sekaligus (pisah baris/spasi).`
        );
      }
      const result = processSale(imeis, ctx.sender);
      return formatSaleReply(result, prefix);
    }

    case "laporan":
    case "report": {
      const days = parseInt(argStr, 10) || 1;
      const rep = db.salesReport(days);
      const label = days === 1 ? "hari ini" : `${days} hari terakhir`;
      if (!rep.total) return `📊 Belum ada penjualan (${label}).`;
      const lines = rep.perModel.map((r) => `• ${r.model}: ${r.sold} unit`);
      return `📊 *LAPORAN PENJUALAN* (${label})\n\n${lines.join("\n")}\n\n*Total terjual: ${rep.total} unit*`;
    }

    case "id": {
      // Utility: cetak ID chat, berguna untuk mengisi GROUP_ID.
      return `🆔 Chat ID:\n${ctx.chatId || "(tidak tersedia)"}`;
    }

    case "help":
    case "menu": {
      return [
        "🤖 *BOT STOK VIVO — PERINTAH*",
        "",
        "📝 *Cara catat penjualan:*",
        "Cukup *ketik nomor IMEI* di grup ini.",
        "Stok otomatis berkurang & bot balas sisa stok.",
        "Bisa beberapa IMEI sekaligus (pisah baris).",
        "",
        `${prefix}stok — lihat semua stok (dikelompokkan per toko)`,
        `${prefix}stok <model> — stok model tertentu, rincian per toko & warna`,
        `${prefix}stok <toko> — stok satu toko, rincian per model & warna`,
        `${prefix}stokdetail — semua stok LENGKAP dengan daftar IMEI per unit`,
        `${prefix}stokdetail <model|toko> — stok detail terfilter model/toko`,
        `${prefix}jual <imei> — catat terjual (eksplisit)`,
        `${prefix}laporan [hari] — laporan penjualan`,
        "",
        "*Admin:*",
        `${prefix}tambah <imei> <toko>/<model>[ RAM]/<warna> — tambah unit`,
        `  contoh: ${prefix}tambah 490154203237518 Carpus/Y05 4/128/Hitam`,
        `  bisa banyak unit sekaligus: satu baris per unit setelah baris pertama,`,
        `  boleh beda toko/model/warna tiap baris (kedatangan barang campur tipe)`,
        `${prefix}pindah <imei> <toko_tujuan> — pindah unit antar toko`,
        `  contoh: ${prefix}pindah 490154203237518 Carpus`,
        `${prefix}hapus <imei> — hapus unit`,
        "",
        `Toko yang tersedia: ${config.STORES.join(", ")}`,
      ].join("\n");
    }

    default:
      return null; // bukan perintah yang dikenal -> abaikan
  }
}

module.exports = { handleCommand, fmtStockSummary, isAdmin };
