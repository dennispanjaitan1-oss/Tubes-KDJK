# NEXA — Peer-to-Peer Messenger (Tubes)

Hasil pemeriksaan, perubahan, bukti tes, dan batasan runtime tersedia di [laporan audit lengkap](docs/FULL_AUDIT_REPORT.md).

Tes: jalankan `npm test` pada client dan server, `npm run test:e2e` pada client (Chrome dan MySQL aktif), serta `npm run test:db` pada server setelah E2E. Tes browser memakai port 4010/5174 dan menambahkan akun/pesan fixture; data pengguna yang sudah ada tidak dihapus.

Aplikasi web React + Express + MySQL + Socket.IO signaling + WebRTC DataChannel.
Dibuat sebagai fondasi **runnable MVP** untuk tugas kelompok, bukan aplikasi WhatsApp produksi.

## Implementasi tersedia

- Daftar dan login (password bcrypt; JWT 7 hari).
- Cari pengguna, tambah peer, daftar peer dan status online.
- Percakapan personal, riwayat teks tersimpan di MySQL.
- Group chat 3–5 orang dengan pengiriman melalui DataChannel ke masing-masing anggota aktif (mesh).
- Voice note lewat MediaRecorder, dan file transfer kecil melalui WebRTC DataChannel (maksimum 1,5 MB).
- Indikator koneksi, monitor getStats (RTT, byte terkirim/diterima), pencarian chat.
- Reply (referensi UUID), dark/light mode, tampilan responsif, typing indicator sederhana.
- Penanganan percakapan baru yang disiarkan melalui signaling server.

## Batasan yang perlu diketahui

- **Voice note dan file hanya tersedia pada sesi P2P saat transfer.** MySQL hanya menyimpan metadata; file tidak disimpan permanen. Refresh browser akan membuat file lama tidak dapat diputar/diunduh. Untuk permanen perlu object storage atau sistem penyimpanan lokal peer dan sinkronisasi khusus.
- **Ketika peer offline, teks tersimpan di database lalu bisa dibaca ketika percakapan dibuka kembali** (store-and-fetch via server), bukan pengiriman P2P ketika offline.
- **Tidak termasuk video/voice call, emoji reaction tersinkron, edit/delete pesan, read receipts autentik, pengiriman ulang otomatis, end-to-end encryption tingkat aplikasi, dan transfer file besar.** Koneksi WebRTC DataChannel sendiri memakai DTLS transport.
- WebRTC mencoba jalur langsung via STUN; tanpa TURN beberapa kombinasi NAT/firewall tidak bisa tersambung.
- Demo gunakan satu tab/browser per akun; koneksi signaling baru untuk akun yang sama menggantikan sesi sebelumnya dengan pemberitahuan yang jelas.
- Untuk koneksi dua laptop beda jaringan/komputer gunakan server yang dapat dijangkau keduanya; set `VITE_API_URL` ke alamat server. Untuk microphone browser selain localhost memerlukan HTTPS.
- `CLIENT_ORIGIN` hanya satu origin untuk demo. Jika melayani dua origin berbeda, sesuaikan konfigurasi CORS.
- Indikator status pesan di UI bersifat sederhana, belum merupakan read-receipts per penerima yang lengkap.
- Belum audit keamanan untuk deployment publik. Gunakan hanya pada lingkungan pembelajaran.

## Prasyarat

- Node.js 20+.
- MySQL 8.x server aktif.
- Dua browser berbeda / dua laptop untuk uji P2P.

## Instalasi

**1. Database**

Jalankan `server/sql/schema.sql` di MySQL Workbench, atau terminal:

```bash
mysql -u root -p < server/sql/schema.sql
```

**2. Backend**

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Edit `server/.env` terutama `DB_USER`, `DB_PASSWORD`, `JWT_SECRET` (ganti minimal 24 karakter), serta `CLIENT_ORIGIN` bila perlu.

API default: `http://localhost:4000`.

**3. Frontend** (terminal lain)

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Buka `http://localhost:5173`.

> Di Windows PowerShell, gunakan `Copy-Item .env.example .env` sebagai pengganti `cp`.

## Demonstrasi peer A & B

1. Buka browser Chrome normal dan browser Edge/InPrivate, masing-masing ke `http://localhost:5173`.
2. Register akun `andi` dan `budi`. Login di dua browser.
3. Akun Andi → **Peers** → cari Budi → tombol pesan; di Budi lakukan hal sama jika percakapan belum muncul.
4. Lihat status **P2P Connected**. Kirim teks dua arah.
5. Buka menu **Network** pada salah satu browser untuk memantau DataChannel dan statistik WebRTC.
6. Tambah akun ketiga untuk membuat grup, lalu uji group chat.
7. Kirim voice note/file kecil saat kedua peer online dan terhubung.
8. Refresh browser untuk memeriksa bahwa riwayat teks dimuat dari MySQL.

## Arsitektur komunikasi

```text
Browser A ←───── WebRTC DataChannel ─────→ Browser B
   │                                         │
   └──── Socket.IO signaling ── Express ─────┘
                                │
                               MySQL
```

- Server hanya membantu `offer`, `answer`, ICE candidate, presence, pembuatan percakapan dan penyimpanan riwayat.
- Isi pesan **aktif** diteruskan lewat WebRTC DataChannel, bukan `socket.emit('send-message')`.
- Untuk grup, pengirim membuka satu DataChannel per anggota lainnya.
- Browser meminta penyimpanan teks ke REST API secara terpisah (jadi server juga menerima salinan pesan untuk riwayat; **bukan** untuk routing pesan aktif).

## Pembagian kerja tim 5 orang

1. **System analyst / integrasi**: alur, dokumentasi, testing, merge dan presentasi.
2. **Frontend**: React, layout, autentikasi, UX chat, tema responsif.
3. **Backend**: REST, login, keamanan, Socket.IO signaling.
4. **WebRTC**: offer/answer/ICE, mesh, lifecycle DataChannel, transfer file, statistik.
5. **DB / fitur**: skema SQL, group membership, history, voice note, pengujian integrasi.

## Skenario evaluasi

- 2 akun login serentak → memilih percakapan → signaling → DataChannel `open` → kirim pesan → receiver menampilkan tanpa relay chat server.
- 3 akun dalam grup → dua koneksi berbeda dari pengirim → semua menerima pesan.
- Perlihatkan log koneksi `RTCPeerConnection`, statistik getStats, dan isi tabel `messages` di MySQL.

## Pengembangan berikutnya

1. Simpan media permanen di object storage atau penyimpanan per-peer yang disinkronkan.
2. Implementasi `message_ack` yang persisten dan read receipts per-member.
3. TURN credential server dan autentikasi signaling yang diperketat.
4. Pengiriman chunk binary dengan checksum + retries untuk file besar.
5. Perluasan pengujian otomatis yang sudah tersedia ke browser lain, TURN, dan kegagalan jaringan fisik.
6. Video call (MediaStreamTrack), notifikasi, edit/delete sinkron.
