// src/database.js
// Lapisan database menggunakan better-sqlite3 (sinkron, cepat, tanpa server terpisah).

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, "vivo_stock.db");
const db = new Database(DB_PATH);

// Aktifkan WAL untuk performa & konkurensi baca yang lebih baik.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- Skema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS models (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS units (
    imei        TEXT PRIMARY KEY,
    model_id    INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'available',  -- available | sold
    toko        TEXT,
    warna       TEXT,
    added_by    TEXT,
    added_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    sold_by     TEXT,
    sold_at     TEXT,
    FOREIGN KEY (model_id) REFERENCES models(id)
  );

  CREATE INDEX IF NOT EXISTS idx_units_model  ON units(model_id);
  CREATE INDEX IF NOT EXISTS idx_units_status ON units(status);
`);

// --- Migrasi untuk database lama (dibuat sebelum kolom toko/warna ada) ---
// Aman dijalankan berkali-kali: hanya menambah kolom bila belum ada,
// data unit yang sudah tersimpan tidak tersentuh/hilang.
// Harus jalan SEBELUM index toko dibuat, karena tabel lama bisa saja sudah
// ada tanpa kolom toko/warna (CREATE TABLE IF NOT EXISTS di atas jadi no-op).
const existingCols = db.prepare("PRAGMA table_info(units)").all().map((c) => c.name);
if (!existingCols.includes("toko")) {
  db.exec("ALTER TABLE units ADD COLUMN toko TEXT");
}
if (!existingCols.includes("warna")) {
  db.exec("ALTER TABLE units ADD COLUMN warna TEXT");
}

db.exec("CREATE INDEX IF NOT EXISTS idx_units_toko ON units(toko)");

// --- Helper model ---
function getOrCreateModel(name) {
  const clean = name.trim();
  const existing = db.prepare("SELECT id, name FROM models WHERE name = ? COLLATE NOCASE").get(clean);
  if (existing) return existing;
  const info = db.prepare("INSERT INTO models (name) VALUES (?)").run(clean);
  return { id: info.lastInsertRowid, name: clean };
}

function findModelByName(name) {
  return db.prepare("SELECT id, name FROM models WHERE name = ? COLLATE NOCASE").get(name.trim());
}

// --- Operasi unit ---

/**
 * Tambah satu unit ke stok.
 * return: { ok, reason, model }
 */
function addUnit(imei, modelName, toko, warna, addedBy) {
  const existing = db.prepare("SELECT imei, status FROM units WHERE imei = ?").get(imei);
  if (existing) {
    return { ok: false, reason: "duplicate", status: existing.status };
  }
  const model = getOrCreateModel(modelName);
  db.prepare(
    "INSERT INTO units (imei, model_id, status, toko, warna, added_by) VALUES (?, ?, 'available', ?, ?, ?)"
  ).run(imei, model.id, toko, warna, addedBy || null);
  return { ok: true, model, toko, warna };
}

/**
 * Tandai satu unit sebagai terjual berdasarkan IMEI.
 * return: { ok, reason, model, remaining }
 */
function sellUnit(imei, soldBy) {
  const unit = db
    .prepare(
      `SELECT u.imei, u.status, u.toko, u.warna, m.id AS model_id, m.name AS model_name
       FROM units u JOIN models m ON m.id = u.model_id
       WHERE u.imei = ?`
    )
    .get(imei);

  if (!unit) return { ok: false, reason: "not_found" };
  if (unit.status === "sold") return { ok: false, reason: "already_sold", model: { name: unit.model_name } };

  db.prepare(
    "UPDATE units SET status = 'sold', sold_by = ?, sold_at = datetime('now','localtime') WHERE imei = ?"
  ).run(soldBy || null, imei);

  const remaining = db
    .prepare("SELECT COUNT(*) AS c FROM units WHERE model_id = ? AND status = 'available'")
    .get(unit.model_id).c;

  return {
    ok: true,
    model: { id: unit.model_id, name: unit.model_name },
    toko: unit.toko,
    warna: unit.warna,
    remaining,
  };
}

/**
 * Pindahkan satu unit (available) dari toko asal ke toko tujuan.
 * return: { ok, reason, model, warna, fromToko, toToko }
 */
function moveUnit(imei, newToko) {
  const unit = db
    .prepare(
      `SELECT u.imei, u.status, u.toko, u.warna, m.name AS model_name
       FROM units u JOIN models m ON m.id = u.model_id
       WHERE u.imei = ?`
    )
    .get(imei);

  if (!unit) return { ok: false, reason: "not_found" };
  if (unit.status !== "available") return { ok: false, reason: "not_available", status: unit.status };
  if ((unit.toko || "").toLowerCase() === newToko.toLowerCase()) {
    return { ok: false, reason: "same_store" };
  }

  db.prepare("UPDATE units SET toko = ? WHERE imei = ?").run(newToko, imei);

  return {
    ok: true,
    model: unit.model_name,
    warna: unit.warna,
    fromToko: unit.toko,
    toToko: newToko,
  };
}

/**
 * Hapus unit dari database (mis. salah input).
 */
function removeUnit(imei) {
  const info = db.prepare("DELETE FROM units WHERE imei = ?").run(imei);
  return { ok: info.changes > 0 };
}

// --- Laporan / query ---

/**
 * Rekap stok tersedia, dikelompokkan per toko -> model -> warna.
 * return: [{ toko, model, warna, available }]
 */
function stockSummary() {
  return db
    .prepare(
      `SELECT COALESCE(u.toko, '(belum diisi)') AS toko,
              m.name AS model,
              COALESCE(u.warna, '-') AS warna,
              COUNT(u.imei) AS available
       FROM units u
       JOIN models m ON m.id = u.model_id
       WHERE u.status = 'available'
       GROUP BY toko, m.id, warna
       ORDER BY toko, m.name, warna`
    )
    .all();
}

/**
 * Stok satu model tertentu, dirinci per toko & warna.
 * return: { model, rows: [{toko, warna, available}], total } | null
 */
function stockForModel(name) {
  const model = findModelByName(name);
  if (!model) return null;
  const rows = db
    .prepare(
      `SELECT COALESCE(toko, '(belum diisi)') AS toko,
              COALESCE(warna, '-') AS warna,
              COUNT(*) AS available
       FROM units
       WHERE model_id = ? AND status = 'available'
       GROUP BY toko, warna
       ORDER BY toko, warna`
    )
    .all(model.id);
  const total = rows.reduce((s, r) => s + r.available, 0);
  return { model: model.name, rows, total };
}

/**
 * Stok satu toko tertentu, dirinci per model & warna.
 * return: { toko, rows: [{model, warna, available}], total }
 */
function stockForStore(toko) {
  const rows = db
    .prepare(
      `SELECT m.name AS model,
              COALESCE(u.warna, '-') AS warna,
              COUNT(*) AS available
       FROM units u
       JOIN models m ON m.id = u.model_id
       WHERE u.status = 'available' AND u.toko = ? COLLATE NOCASE
       GROUP BY m.id, warna
       ORDER BY m.name, warna`
    )
    .all(toko);
  const total = rows.reduce((s, r) => s + r.available, 0);
  return { toko, rows, total };
}

/**
 * Laporan penjualan pada rentang hari terakhir (default 1 = hari ini).
 * return: { total, perModel: [{model, sold}] }
 */
function salesReport(days = 1) {
  const perModel = db
    .prepare(
      `SELECT m.name AS model, COUNT(u.imei) AS sold
       FROM units u JOIN models m ON m.id = u.model_id
       WHERE u.status = 'sold'
         AND u.sold_at >= datetime('now','localtime', ?)
       GROUP BY m.id
       ORDER BY sold DESC`
    )
    .all(`-${days} day`);
  const total = perModel.reduce((s, r) => s + r.sold, 0);
  return { total, perModel, days };
}

/**
 * Rincian unit tersedia lengkap dengan IMEI, dikelompokkan per toko -> model -> warna.
 * opts: { toko?, modelName? } untuk memfilter hasil.
 * return: [{ toko, model, warna, imei }]
 */
function stockDetailed(opts = {}) {
  const { toko, modelName } = opts;
  let sql = `
    SELECT COALESCE(u.toko, '(belum diisi)') AS toko,
           m.name AS model,
           COALESCE(u.warna, '-') AS warna,
           u.imei AS imei
    FROM units u
    JOIN models m ON m.id = u.model_id
    WHERE u.status = 'available'`;
  const params = [];
  if (toko) {
    sql += " AND u.toko = ? COLLATE NOCASE";
    params.push(toko);
  }
  if (modelName) {
    sql += " AND m.name = ? COLLATE NOCASE";
    params.push(modelName);
  }
  sql += " ORDER BY toko, m.name, warna, u.imei";
  return db.prepare(sql).all(...params);
}

function totalAvailable() {
  return db.prepare("SELECT COUNT(*) AS c FROM units WHERE status = 'available'").get().c;
}

module.exports = {
  db,
  getOrCreateModel,
  findModelByName,
  addUnit,
  sellUnit,
  moveUnit,
  removeUnit,
  stockSummary,
  stockForModel,
  stockForStore,
  stockDetailed,
  salesReport,
  totalAvailable,
};
