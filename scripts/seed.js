// scripts/seed.js
// Impor stok awal secara massal dari file CSV.
//
// Format CSV (dengan header):
//   imei,toko,model,warna
//   490154203237518,Carpus,Vivo Y17s,Hitam
//   356938035643809,Carten,Vivo Y28,Biru
//
// Jalankan: node scripts/seed.js data/stok_awal.csv

const fs = require("fs");
const path = require("path");
const db = require("../src/database");
const config = require("../src/config");
const { normalizeImei } = require("../src/imei");

const file = process.argv[2] || path.join(__dirname, "..", "data", "stok_awal.csv");

if (!fs.existsSync(file)) {
  console.error(`❌ File tidak ditemukan: ${file}`);
  console.error("Buat file CSV dengan kolom: imei,toko,model,warna");
  process.exit(1);
}

const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
// Lewati header jika ada
if (/imei/i.test(lines[0]) && /model/i.test(lines[0])) lines.shift();

let ok = 0;
let skip = 0;
let dup = 0;

for (const line of lines) {
  const [rawImei, rawToko, rawModel, rawWarna] = line.split(",");
  const imei = normalizeImei(rawImei);
  const tokoRaw = (rawToko || "").trim();
  const model = (rawModel || "").trim();
  const warna = (rawWarna || "").trim();
  const toko = config.STORES.find((s) => s.toLowerCase() === tokoRaw.toLowerCase());

  if (!imei || !toko || !model || !warna) {
    console.warn(`⏭️  Lewati (data tidak valid, cek imei/toko/model/warna): ${line}`);
    skip++;
    continue;
  }

  const r = db.addUnit(imei, model, toko, warna, "seed");
  if (r.ok) {
    ok++;
  } else if (r.reason === "duplicate") {
    dup++;
  }
}

console.log(`\n✅ Selesai. Ditambahkan: ${ok}, duplikat: ${dup}, dilewati: ${skip}`);
console.log("\n📦 Rekap stok saat ini:");
for (const row of db.stockSummary()) {
  console.log(`   • ${row.toko} — ${row.model} (${row.warna}): ${row.available} unit`);
}
