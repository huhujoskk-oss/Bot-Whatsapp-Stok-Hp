// src/index.js
// Entry point: menyambungkan WhatsApp Web ke database & perintah.
// Penjualan dicatat dengan MENGETIK IMEI langsung di grup (tanpa OCR/foto).

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const config = require("./config");
const { extractImeis } = require("./imei");
const { handleCommand } = require("./commands");
const { processSale, formatSaleReply } = require("./sales");

// --- Inisialisasi client WhatsApp ---
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./data/wa-session" }),
  // Jangan pin versi WA Web tertentu (rawan basi saat WhatsApp update internal-nya
  // dan bikin getChat/getChatById gagal) -- selalu ambil versi terbaru dari WhatsApp.
  webVersionCache: { type: "none" },
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

function log(...args) {
  console.log(new Date().toISOString(), "-", ...args);
}

// --- QR untuk login pertama kali ---
client.on("qr", (qr) => {
  console.log("\n📱 Scan QR ini dengan WhatsApp (Perangkat Tertaut):\n");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => log("✅ Terautentikasi."));
client.on("auth_failure", (m) => log("❌ Gagal autentikasi:", m));

client.on("disconnected", async (reason) => {
  log("⚠️ Terputus:", reason);

  if (reason === "LOGOUT") {
    log("🔑 Sesi dibatalkan WhatsApp. Hapus sesi lalu scan ulang:");
    log("   rm -rf data/wa-session .wwebjs_cache");
    try { await client.destroy(); } catch (_) {}
    process.exit(1); // biar PM2 tidak restart-loop tanpa guna
  }

  // Putus sementara (jaringan) -> biarkan PM2 restart
  try { await client.destroy(); } catch (_) {}
  process.exit(1);
});

// Jangan biarkan error Puppeteer saat teardown menjatuhkan proses diam-diam.
process.on("unhandledRejection", (err) => {
  log("Unhandled rejection:", err && err.message ? err.message : err);
});
process.on("uncaughtException", (err) => {
  log("Uncaught exception:", err && err.message ? err.message : err);
  process.exit(1);
});

client.on("ready", () => {
  log("🤖 Bot Stok Vivo siap!");
  if (!config.GROUP_ID) {
    log('ℹ️  GROUP_ID belum diisi. Ketik "#id" di grup target, lalu isikan di .env.');
  } else {
    log("📌 Beroperasi pada grup:", config.GROUP_ID);
  }
  log(config.AUTO_DETECT_IMEI
    ? "🔎 Deteksi IMEI otomatis: AKTIF (ketik IMEI di grup = terjual)"
    : `🔎 Deteksi otomatis: NONAKTIF (pakai ${config.PREFIX}jual <imei>)`);
});

async function reply(msg, text) {
  try {
    await msg.reply(text);
  } catch (e) {
    log("Gagal membalas:", e.message);
  }
}

// Nomor pengirim tanpa @c.us
function senderNumber(msg) {
  const id = msg.author || msg.from || "";
  return id.split("@")[0];
}

// --- Handler pesan masuk ---
client.on("message", async (msg) => {
  try {
    // Abaikan media & pesan sistem; sistem ini murni berbasis teks.
    if (msg.hasMedia || !msg.body) return;

    // Pakai msg.from langsung (bukan msg.getChat()) -- getChat/getChatById
    // sempat gagal karena isu kompatibilitas whatsapp-web.js dengan WhatsApp
    // Web terbaru, sedangkan msg.from sudah cukup untuk ID chat/grup asal pesan.
    const chatId = msg.from;
    const isTargetGroup = !config.GROUP_ID || chatId === config.GROUP_ID;

    const ctx = { sender: senderNumber(msg), chatId, config };
    const body = msg.body.trim();

    // 1) Perintah teks (#stok, #tambah, #jual, ...)
    if (body.startsWith(config.PREFIX)) {
      const isIdCmd = body.toLowerCase().startsWith(config.PREFIX + "id");
      // #id boleh di chat mana saja agar mudah menemukan GROUP_ID saat setup.
      if (!isTargetGroup && !isIdCmd) return;

      const response = handleCommand(body, ctx);
      if (response !== null) await reply(msg, response);
      return;
    }

    if (!isTargetGroup) return;

    // 2) Pesan biasa: cari IMEI yang diketik manual.
    if (!config.AUTO_DETECT_IMEI) return;

    const imeis = extractImeis(body);
    if (!imeis.length) return; // obrolan biasa -> diamkan, jangan spam grup

    log(`📝 ${imeis.length} IMEI dari ${ctx.sender}: ${imeis.join(", ")}`);

    const result = processSale(imeis, ctx.sender);

    // Jika tidak satu pun IMEI dikenali, tetap beri tahu agar tidak "hilang diam-diam".
    if (config.REPLY_IN_GROUP || result.sold.length === 0) {
      await reply(msg, formatSaleReply(result, config.PREFIX));
    }

    if (result.sold.length) {
      log(`✅ Terjual ${result.sold.length} unit: ` +
          result.sold.map((s) => `${s.model}(${s.imei})`).join(", "));
    }
  } catch (e) {
    log("Handler error:", e && e.stack ? e.stack : e);
  }
});

// --- Shutdown rapi ---
async function shutdown() {
  log("Menutup...");
  try {
    await client.destroy();
  } catch (_) {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

client.initialize();
