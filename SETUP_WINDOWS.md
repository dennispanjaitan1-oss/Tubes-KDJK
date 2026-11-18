# Panduan khusus Windows 10/11

## 1) Instal software
- Install Node.js versi 20 atau lebih baru: https://nodejs.org/
- Install MySQL 8.x + MySQL Workbench: https://dev.mysql.com/downloads/
- VS Code (opsional).

## 2) Buat database
Buka MySQL Workbench, masuk ke koneksi lokal, pilih **File > Open SQL Script**, buka `server/sql/schema.sql`, lalu tekan tombol **Execute** (ikon petir).

## 3) Jalankan backend via PowerShell
```powershell
cd nexa-p2p\server
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm install
npm run dev
```
Di file `.env`, isi `DB_PASSWORD` sesuai password MySQL dan ubah `JWT_SECRET` menjadi string acak panjang (minimal 24 karakter).

Jika backend berhasil, terminal akan memunculkan:
`NEXA API + signaling active on http://localhost:4000`

Cek browser: `http://localhost:4000/api/health` → `{"ok":true}`.

## 4) Jalankan frontend via PowerShell baru
```powershell
cd nexa-p2p\client
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm install
npm run dev
```
Buka `http://localhost:5173`.

## 5) Uji dua akun
Buka Chrome dan Edge (dua browser berbeda), register masing-masing akun, buka menu **Peers**, mulai percakapan. Uji pesan dua arah dan buka **Network** untuk melihat status DataChannel.

## 6) Uji dua laptop di Wi-Fi yang sama
1. Pada laptop server, jalankan backend + frontend.
2. Jalankan `ipconfig` untuk menemukan IPv4, contoh `192.168.1.5`.
3. Di `client/.env` ganti `VITE_API_URL=http://192.168.1.5:4000`.
4. Di `server/.env` ganti `CLIENT_ORIGIN=http://192.168.1.5:5173`.
5. Restart dua proses Node.
6. Buka `http://192.168.1.5:5173` pada **kedua laptop**.
7. Pastikan Windows Firewall mengizinkan port 4000 dan 5173 pada jaringan privat.

Penting: browser mengharuskan secure context untuk mikrofon. Dari alamat IP LAN berawalan `http://`, voice note dapat ditolak oleh browser. Untuk uji voice note lintas perangkat, jalankan frontend+API melalui HTTPS tepercaya atau tunneling HTTPS. Chat teks WebRTC dapat tetap berfungsi lewat LAN.
