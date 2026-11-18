# NEXA: penjelasan singkat dan cara menjalankan

## Ini proyek apa? Pakai React atau HTML?

NEXA adalah aplikasi chat berbasis web untuk demo komunikasi peer-to-peer (P2P). Jadi, pengguna bisa saling chat lewat browser.

Tampilannya **pakai React 18 dengan JavaScript/JSX**, dibantu Vite. HTML tetap ada sebagai halaman dasar, dan CSS mengatur tampilannya. Jadi bukan kumpulan halaman HTML statis saja.

| Bagian | Pakai apa dan buat apa? |
|---|---|
| Tampilan (`client`) | React + CSS, untuk halaman login, chat, dan monitor koneksi |
| Server (`server`) | Node.js + Express, untuk login dan API data |
| Database | MySQL, untuk akun, kontak, grup, dan riwayat teks |
| Koneksi chat | WebRTC DataChannel, untuk mengirim data langsung antar-browser saat terhubung |
| Penghubung awal | Socket.IO, untuk membantu browser saling menemukan dan membentuk koneksi, serta status online |
| Login | bcrypt untuk hash password dan JWT untuk sesi login |

## Fitur yang sudah ada

- Daftar/login, cari pengguna, tambah peer, dan lihat status online.
- Chat pribadi dan grup 3–5 orang. Pada grup, pengirim mengirim ke tiap anggota yang terhubung.
- Riwayat teks, balas pesan, pencarian percakapan, dan indikator sedang mengetik.
- Kirim file kecil dan voice note, maksimal 1,5 MB.
- Monitor koneksi P2P: status, waktu bolak-balik data (RTT), serta jumlah byte terkirim/diterima.
- Mode terang/gelap dan tampilan yang menyesuaikan ukuran layar.

Alurnya: **login ke server → server membantu menghubungkan peer → chat aktif lewat WebRTC**. Salinan teks juga dikirim ke API supaya riwayatnya tersimpan di MySQL. Jadi aplikasi ini masih membutuhkan server, bukan P2P yang sepenuhnya tanpa server.

## Kesesuaian dengan Tubes

**Ketentuan/rubrik resmi dosen belum ada di repo, jadi belum bisa dipastikan 100% sesuai.** Berikut bagian yang bisa dicocokkan dengan ketentuan kalian:

| Aspek yang perlu dicocokkan | Implementasi proyek |
|---|---|
| Komunikasi P2P | Chat aktif memakai WebRTC DataChannel |
| Komunikasi beberapa pengguna | Chat pribadi dan grup dengan koneksi antaranggota (mesh) |
| Penyimpanan data | MySQL menyimpan akun, percakapan, dan riwayat teks |
| Transfer data/media | Teks, file kecil, dan voice note |
| Pengamatan jaringan | Monitor koneksi, RTT, dan byte transfer |

Batasan yang perlu dijelaskan saat presentasi: file/audio tidak tersimpan permanen dan bisa hilang setelah refresh; teks saat penerima offline dibaca kembali dari server; belum ada panggilan suara/video atau enkripsi end-to-end tingkat aplikasi. Konfigurasi baru memakai STUN, belum TURN, sehingga koneksi beda jaringan bisa gagal. Kalau rubrik meminta fitur tersebut atau P2P tanpa penyimpanan pesan di server, masih perlu penyesuaian.

## Teman baru mau ambil dan menjalankan proyek

Langkah berikut untuk Windows, **pakai Git Bash** agar perintahnya sama. Siapkan Git, Node.js yang memenuhi syarat proyek (20+), serta MySQL Server 8.x dan MySQL Workbench. Pastikan layanan MySQL menyala.

### 1. Ambil proyek sekali saja (clone)

Buka Git Bash di folder tempat menyimpan proyek:

```bash
git clone https://github.com/dennispanjaitan1-oss/Tubes-KDJK.git
cd Tubes-KDJK
```

Di dalam `Tubes-KDJK` sudah langsung ada folder `client` dan `server`; tidak perlu masuk folder `nexa-p2p` lagi. Pertama kali pakai **clone**, sedangkan **pull** untuk mengambil perubahan berikutnya.

### 2. Siapkan database

Di MySQL Workbench, buka koneksi MySQL lokal. Pilih **File → Open SQL Script**, buka `server/sql/schema.sql`, lalu jalankan seluruh script dengan tombol petir. Script membuat database `nexa_p2p` dan tabelnya. Ini cukup untuk setup awal, tidak perlu diulang setiap menjalankan aplikasi.

### 3. Atur dan jalankan server

Dari folder `Tubes-KDJK`:

```bash
cd server
cp -n .env.example .env
npm ci
notepad .env
```

Simpan perubahan pada `.env`: isi `DB_USER` dan `DB_PASSWORD` sesuai MySQL komputer sendiri. Ganti `JWT_SECRET` dengan teks acak pribadi minimal 24 karakter. Untuk demo lokal, pengaturan lainnya boleh tetap. Perintah `cp -n` menjaga `.env` yang sudah ada agar tidak tertimpa.

```bash
npm run dev
```

Biarkan terminal ini menyala. Buka `http://localhost:4000/api/health`; kalau berhasil akan muncul `{"ok":true}`.

### 4. Jalankan tampilan

Buka **terminal Git Bash kedua** di folder `Tubes-KDJK`:

```bash
cd client
cp -n .env.example .env
npm ci
npm run dev
```

Buka **http://localhost:5173**. Nilai `VITE_API_URL` di `client/.env` untuk setup lokal adalah `http://localhost:4000`. Kedua terminal harus tetap menyala; tekan `Ctrl+C` untuk menghentikan aplikasi.

### 5. Coba chat

Buka Chrome dan Edge, lalu daftar dua akun berbeda. Dari menu **Peers**, cari akun satunya dan mulai chat. Tunggu **P2P Connected**, lalu coba kirim teks, file kecil, atau voice note (izinkan mikrofon). Buka menu **Network** untuk melihat koneksinya.

Kalau setiap teman menjalankan server dan database sendiri, data akun mereka terpisah. Untuk saling chat antar-laptop, gunakan satu server bersama. Panduan Wi-Fi yang sama ada di [SETUP_WINDOWS.md bagian 6](SETUP_WINDOWS.md#6-uji-dua-laptop-di-wi-fi-yang-sama). Voice note lewat alamat IP LAN membutuhkan HTTPS agar mikrofon bisa dipakai.

## Kalau sudah pernah clone dan mau pull pembaruan

Hentikan aplikasi dengan `Ctrl+C`, lalu dari folder `Tubes-KDJK`:

```bash
git status
```

Kalau ada perubahan kode sendiri, simpan lewat commit atau stash dulu. Setelah working tree bersih:

```bash
git pull --ff-only origin main
cd server
npm ci
cd ../client
npm ci
```

Jalankan lagi `npm run dev` di terminal `server` dan `client`. `.env` tidak ikut Git, jadi tetap memakai konfigurasi komputer masing-masing. Jika `.env.example` berubah, tambahkan pengaturan barunya ke `.env` sendiri. Kalau pull ditolak karena riwayat branch berbeda, koordinasikan dengan tim; jangan langsung reset atau menghapus pekerjaan.

**Kalau gagal jalan:** cek MySQL aktif dan password benar, kedua terminal menyala, serta port 4000/5173 tidak sedang dipakai aplikasi lain. Akun dari komputer teman tidak otomatis ada di database lokalmu; daftar akun baru untuk uji lokal.
