# 🤖 Bot Stok HP (WhatsApp)

Bot WhatsApp untuk manajemen stok HP Vivo. Cukup **ketik nomor IMEI** di grup,
bot otomatis mengurangi stok dan mengirim laporan sisa stok ke grup.

> Versi ini **tidak memakai OCR/foto**. Input IMEI dilakukan manual (diketik/paste)
> agar lebih andal, ringan, dan tidak butuh dependensi berat.

## ✨ Fitur

- 📝 **Otomatis**: ketik IMEI di grup → stok berkurang → bot balas sisa stok
- 🔢 Bisa **beberapa IMEI sekaligus** dalam satu pesan (pisah baris/spasi/koma)
- 🛡️ Validasi ketat (15 digit + checksum Luhn) — nomor HP, harga, dan tanggal
  **tidak** akan salah terbaca sebagai IMEI
- 🔁 Deteksi penjualan ganda & IMEI yang belum terdaftar
- 📦 Cek stok kapan saja (`#stok`)
- 🛠️ Tambah/hapus stok (khusus admin)
- 📊 Laporan penjualan harian/mingguan
- 💾 Database SQLite (tanpa server DB terpisah) — mudah dibackup

## 🧱 Arsitektur

```
Pesan grup  →  WhatsApp Web (whatsapp-web.js)  →  index.js
                                                     │
                        ┌──────────────┬─────────────┼─────────────┐
                        ▼              ▼             ▼             ▼
                    imei.js       commands.js     sales.js    database.js
                (ekstrak/valid)  (perintah #)   (proses jual)  (SQLite)
```

Data disimpan di `data/vivo_stock.db`. Sesi login WhatsApp di `data/wa-session/`
(scan QR cukup sekali).

---

## 🚀 Instalasi di VM Proxmox

### 1. Siapkan VM
- OS: Ubuntu Server 22.04 / 24.04. RAM min. 1 GB (Chromium butuh memori).
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # pastikan v20.x
```

### 3. Install dependency sistem untuk Chromium (dipakai whatsapp-web.js)
```bash
sudo apt install -y \
  ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0 \
  libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \
  libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libxcomposite1 libxdamage1 libxext6 \
  libxfixes3 libxrandr2 libxkbcommon0 xdg-utils
```
> Di Ubuntu 22.04 paketnya bernama `libasound2` (bukan `libasound2t64`).

### 4. Ambil kode & install paket Node
```bash
cd vivo-bot
npm install
```
> `npm install` meng-compile `better-sqlite3` dan mengunduh Chromium. Tunggu sampai selesai.
> Jika `better-sqlite3` gagal compile: `sudo apt install -y build-essential python3`

### 5. Konfigurasi
```bash
cp .env.example .env
nano .env
```
Isi `ADMINS` dengan nomor Anda (mis. `6281234567890`). `GROUP_ID` biarkan kosong dulu.

### 6. Jalankan pertama kali & scan QR
```bash
npm start
```
QR muncul di terminal. Di HP: **WhatsApp → Perangkat Tertaut → Tautkan Perangkat** → scan.

### 7. Dapatkan GROUP_ID
Setelah bot `ready`, buka grup target lalu ketik:
```
#id
```
Bot membalas ID grup. Salin ke `.env` pada `GROUP_ID=`, simpan, lalu restart bot.

### 8. Jalankan permanen dengan PM2
```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup     # ikuti perintah yang ditampilkan agar auto-start saat reboot
```
Cek log: `
`

---

## 📥 Isi Stok Awal (massal via CSV)

Buat `data/stok_awal.csv` dengan kolom `imei,toko,model,warna`. Nama toko harus salah satu
dari daftar `STORES` di `.env` (default: Carpus, Carten, Kaba, Pasar):
```
imei,toko,model,warna
490154203237518,Carpus,Vivo Y17s,Hitam
356938035643809,Carten,Vivo Y28,Biru
```
Lalu:
```bash
node scripts/seed.js data/stok_awal.csv
```

---

## 💬 Cara Pakai (di dalam grup)

### Catat penjualan — cukup ketik IMEI
```
490154203237518
```
Bot balas:
```
🔻 TERJUAL (1 unit)

• Vivo Y17s (Hitam)
  Toko: Carpus
  IMEI: 490154203237518

📦 Sisa stok:
• Vivo Y17s: 1 unit
```

Beberapa unit sekaligus (pisah baris):
```
490154203237518
356938035643809 
```

IMEI di tengah kalimat juga terbaca:
```
terjual 490154203237518 an. Pak Andi
```

Format dengan strip/spasi juga diterima: `49-0154-2032-37518`

### Daftar perintah

| Aksi | Cara |
|------|------|
| **Jual (otomatis)** | ketik IMEI-nya saja |
| Jual (eksplisit) | `#jual 490154203237518` |
| Lihat semua stok (per toko) | `#stok` |
| Stok satu model (rincian toko & warna) | `#stok Vivo Y17s` |
| Stok satu toko (rincian model & warna) | `#stok Carpus` |
| Laporan hari ini | `#laporan` |
| Laporan 7 hari | `#laporan 7` |
| Tambah unit (admin) | `#tambah 490154203237518 Carpus/Vivo Y17s/Hitam` |
| Pindah unit antar toko (admin) | `#pindah 490154203237518 Carten` |
| Hapus unit (admin) | `#hapus 490154203237518` |
| Menu bantuan | `#help` |
| Lihat ID chat | `#id` |

Format `#tambah`: `#tambah <imei> <toko>/<model>/<warna>` — toko, model, dan warna
dipisahkan tanda `/`. Nama toko harus salah satu dari daftar `STORES` di `.env`
(default: Carpus, Carten, Kaba, Pasar; bisa diubah tanpa ubah kode).

Format `#pindah`: `#pindah <imei> <toko_tujuan>` — memindahkan unit yang masih
tersedia (belum terjual) dari toko asalnya ke toko tujuan. Nama toko tujuan
juga harus salah satu dari daftar `STORES`.

Contoh tampilan `#stok`:
```
📦 STOK VIVO SAAT INI

🏬 Carpus
• Vivo Y17s (Hitam): 3 unit
• Vivo Y17s (Biru): 2 unit

🏬 Carten
• Vivo Y28 (Hitam): 1 unit

Total: 6 unit
```

---

## 🛡️ Keamanan Deteksi IMEI

Bot hanya menerima blok angka yang **tepat 15 digit** dan **lolos checksum Luhn**.
Karena itu pesan berikut **tidak** akan memicu penjualan:

| Pesan | Hasil |
|-------|-------|
| `halo bos, ready Y17s?` | diabaikan |
| `harganya 2.199.000` | diabaikan |
| `hubungi 081234567890` | diabaikan (12 digit) |
| `kirim tgl 09/07/2026` | diabaikan |
| `490154203237519` | diabaikan (gagal Luhn) |
| `4111111111111111` | diabaikan (16 digit) |

Jika sebuah IMEI valid tapi belum terdaftar, bot memberi tahu (tidak diam-diam).

**Matikan deteksi otomatis** bila ingin penjualan hanya lewat perintah eksplisit:
set `AUTO_DETECT_IMEI=false` di `.env`, lalu pakai `#jual <imei>`.

---

## 🔧 Catatan & Tips

- **Backup**: cukup salin `data/vivo_stock.db`. Backup harian otomatis via cron:
  ```bash
  0 1 * * * cp /path/vivo-bot/data/vivo_stock.db /path/backup/vivo_$(date +\%F).db
  ```
- **Upgrade ke MySQL** nanti: cukup ganti isi `src/database.js`; modul lain memanggil
  fungsi yang sama (`sellUnit`, `stockSummary`, dst).
- **Multi-brand** (Oppo, Samsung): nama model bebas, jadi sudah bisa langsung dipakai.
- **Menambah OCR kembali** di kemudian hari: buat `src/ocr.js` yang mengubah gambar → teks,
  lalu alirkan hasilnya ke `extractImeis()`. Sisa sistem tidak perlu diubah.

## ⚠️ Legal
whatsapp-web.js adalah library tidak resmi (bukan dari WhatsApp/Meta). Gunakan pada nomor
khusus operasional dan patuhi Ketentuan Layanan WhatsApp. Untuk skala besar/komersial resmi,
pertimbangkan **WhatsApp Business API** (Cloud API) resmi.

## 📁 Struktur Proyek
```
vivo-bot/
├── src/
│   ├── index.js        # entry point, wiring WhatsApp
│   ├── config.js       # baca .env
│   ├── database.js     # SQLite: skema & query stok
│   ├── imei.js         # ekstraksi & validasi IMEI (Luhn)
│   ├── sales.js        # proses penjualan (batch) & format balasan
│   └── commands.js     # perintah teks (#stok, #tambah, dll)
├── scripts/
│   └── seed.js         # impor stok awal dari CSV
├── data/               # database & sesi WA (dibuat otomatis)
├── ecosystem.config.js # konfigurasi PM2
├── .env.example
└── package.json
```
