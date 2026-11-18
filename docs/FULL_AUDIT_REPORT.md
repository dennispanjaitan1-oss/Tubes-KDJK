# NEXA — Full Audit Report

Tanggal: 17 November 2026, Asia/Jakarta. Lingkup: seluruh source aplikasi, SQL, manifest/lockfile dependency, konfigurasi, dokumentasi, pengujian MySQL serta Chrome lokal. Tidak ada `.env`, akun lama, pesan lama, atau skema database yang dihapus/ditimpa. Pengujian menambahkan fixture dengan awalan `audit_` dan `signal_`, percakapan, serta pesan uji; fixture dipertahankan untuk pemeriksaan, termasuk fixture dari pengujian yang awalnya gagal.

## 1. Executive Summary

Jalur aktif aplikasi tetap **WebRTC RTCDataChannel**. Socket.IO membawa SDP, ICE, presence, dan metadata percakapan; REST menerima salinan riwayat, bukan menyiarkan pesan aktif. Teks offline dibaca kemudian dari MySQL dan tidak diklaim sebagai pengiriman P2P.

Perbaikan difokuskan pada koneksi ganda, pergantian sesi saat refresh, validasi input/payload, idempotency, transfer media, dan keakuratan monitor. Regresi akhir: **2 tes Playwright lulus**, mencakup tiga browser context terisolasi dan pengujian keamanan; **7 unit test dan 1 integration test database lulus**. Build produksi frontend dan syntax check backend lulus. Ini membuktikan perilaku di Chrome lokal, belum kesiapan deployment publik atau lintas semua NAT/browser.

## 2. Problems Found

| No. | File | Masalah | Severity | Penyebab | Dampak |
|---|---|---|---|---|---|
| 1 | `client/src/App.jsx` | Offer masuk selalu menutup PC yang ada | High | Tidak ada aturan glare/negosiasi stabil | Koneksi simultan bisa saling membatalkan |
| 2 | `client/src/App.jsx` | Peer lama dipakai setelah refresh | High | Cleanup bergantung pada state React; signaling tidak membawa identitas sesi asal | SCTP/SDP sesi berbeda bercampur, reconnect tidak konsisten |
| 3 | `client/src/App.jsx` | File base64 ikut dikirim ke API metadata | High | `localMedia` disertakan dalam seluruh objek pesan | Payload melampaui batas JSON 80 KB; transfer tampak terkirim tetapi persistence gagal |
| 4 | `client/src/App.jsx` | Media dari peer tidak memverifikasi keanggotaan dan hash | High | Validasi metadata, akumulasi chunk, timeout tidak memadai | Pesan lintas percakapan dan media rusak dapat diterima |
| 5 | `server/src/index.js` | Credential bertipe objek/array dan password sangat besar | High | Mengandalkan coercion/string length | Error runtime, beban bcrypt, pemotongan password bcrypt di 72 byte |
| 6 | `server/src/index.js` | `INSERT IGNORE` menutupi konflik UUID | High | Idempotency tidak membandingkan pengirim, isi, dan percakapan | Konflik dilaporkan sukses meskipun pesan tidak tersimpan |
| 7 | `server/src/index.js` | Pembuatan direct chat dapat berlomba | Medium | Pencarian sebelum transaksi tanpa penguncian pasangan user | Percakapan personal ganda |
| 8 | `server/src/index.js` | Payload signaling kosong menyebabkan destructuring error; callback DB dapat mengubah urutan event | High | Destructuring sebelum validasi dan handler async paralel | Error event dan ICE/SDP tidak berurutan |
| 9 | `server/src/index.js` | Tidak ada rate limit dan masa socket tidak mengikuti expiry JWT | Medium | Verifikasi token hanya ketika handshake | Beban auth/signaling berlebih dan sesi socket kedaluwarsa tetap aktif |
| 10 | `client/src/App.jsx` | Status delivered tertimpa sent; grup ditandai delivered setelah satu ACK | Medium | Race ACK dan pembaruan status; tidak ada daftar penerima | Status pengiriman menyesatkan |
| 11 | `client/src/App.jsx` | Monitor menganggap adanya relay candidate sebagai informasi rute | Medium | Tidak menggunakan selected transport pair | Kesimpulan rute keliru; byte yang tidak tersedia ditampilkan sebagai 0 |
| 12 | `client/src/App.jsx`, `style.css` | Toast menutupi tombol kirim/mikrofon | Medium | Toast tetap di atas composer tanpa timeout | Klik terhalang; ditemukan langsung oleh Playwright |
| 13 | `client/src/style.css` | Tombol peer hilang di mobile | Medium | CSS menyembunyikan aksi pada layar kecil | Pengguna mobile tidak bisa memulai chat |
| 14 | `client/src/App.jsx` | Recording/transfer tidak memiliki cleanup dan batas tunggu lengkap | Medium | Stream, antrean media, dan backpressure tidak dibatasi | Mikrofon tertinggal, transfer dapat menunggu tanpa akhir |
| 15 | `client/src/App.jsx` | Pencarian hanya memfilter 50 user pertama | Medium | Filtering frontend saja | User di luar hasil awal tidak ditemukan |
| 16 | `client/src/main.jsx` | Tidak ada error boundary | Low | Kesalahan render langsung merusak root | Tidak ada UI pemulihan |

Tidak ditemukan jalur relay chat Socket.IO. Query aplikasi memakai parameter binding; placeholder dinamis grup dibentuk dari jumlah ID yang divalidasi. SQL telah memiliki FK, UUID unik, dan indeks `(conversation_id,id)`; migrasi tidak diperlukan.

## 3. Fixes Implemented

| File | Fungsi/perubahan | Penjelasan | Verifikasi |
|---|---|---|---|
| `client/src/p2p.js` | Lifecycle `PeerLink` | Satu PC per peer; pembuat channel deterministik berdasarkan ID; polite/impolite collision handling, rollback browser, queue ICE terbatas, filter ufrag, queue signaling, cleanup dan ICE restart terbatas | Chrome private/group/refresh/rejoin PASS; kegagalan ICE paksa belum diuji |
| `server/src/index.js`, `client/src/App.jsx` | Identitas sesi | `fromSession` berasal dari `socket.id` server; PC lama ditutup ketika sesi berubah dan saat event offline diterima | Refresh dan close/reopen browser PASS |
| `server/src/index.js` | Sesi ganda | Satu endpoint signaling per akun; sesi lama menerima `session:replaced` dan diputus | Tes socket replacement PASS |
| `client/src/App.jsx` | Media | API hanya menerima metadata; chunk terbatas, verifikasi SHA-256 dan ukuran decoded, timeout backpressure, download MIME aman, ACK media, progress pengiriman | File 190 KB hash identik, download, transfer kedua, oversize dan checksum rusak PASS |
| `client/src/App.jsx` | Recording | Pemeriksaan dukungan API, batas ukuran dengan timeslice, stop tracks pada selesai/error/logout/unmount/pergantian chat | Mikrofon sintetis, audio diterima dan dimainkan PASS |
| `server/src/validation.js`, `server/src/index.js` | Validasi dan keamanan | Credential bertipe benar, password hingga 72 byte, UUID ketat, ID positif, reply dalam percakapan sama, group/signaling validation; JWT HS256; JSON error 400/413; limiter API/auth/signaling | Unit dan security integration PASS |
| `server/src/index.js` | Persistence | Advisory lock MySQL per pasangan direct chat; UUID replay identik idempotent, konflik 409; sender diambil dari JWT | Pembuatan serentak, sender spoofing dan replay PASS |
| `client/src/App.jsx` | Status, history, sesi | ACK per penerima; delivered tidak tertimpa sent; gabungan history mempertahankan status/media; token 401 membersihkan sesi; fetch timeout | Private/group dan refresh PASS |
| `client/src/p2p.js`, `client/src/App.jsx` | Monitor | Selected candidate pair dari transport; tipe kandidat lokal/remote, pair ID, RTT, byte channel, retry/error aktual; data tidak tersedia = N/A | Unit selected-pair/unused-relay dan monitor browser PASS |
| `client/src/App.jsx`, `style.css` | UX | Toast tidak menghalangi klik dan hilang otomatis; textarea multiline; focus outline; daftar dan chat mobile terpisah dengan tombol kembali; pencarian peer ke API | Multiline, batas ukuran, peer actions pada 390×844 PASS; review visual menyeluruh belum dilakukan |
| `client/src/main.jsx` | Error boundary | Halaman pemulihan dengan muat ulang | Build PASS; exception render buatan belum diuji |
| `client/tests`, `server/test` | Tes | Unit, live database integration, Playwright tiga context dan socket security | Hasil di bawah |

## 4. Test Results

Hasil berikut merupakan eksekusi nyata. Status PASS tidak mencakup kasus lain yang hanya diperiksa source-nya.

| Pengujian | Status | Bukti/lingkup |
|---|---|---|
| Dependency tree `npm ls --depth=0` pada client/server | PASS | Dependency terpasang tanpa missing package |
| Audit registry npm client/server | PASS | Nol advisory pada dependency terpasang saat audit; bukan jaminan bebas kerentanan |
| `npm run build` client | PASS | Vite menghasilkan bundle produksi |
| `npm run check` server / `node --check src/index.js` | PASS | Sintaks backend valid |
| `npm test` client | PASS | 3 tes: selected pair, statistik unavailable, checksum |
| `npm test` server | PASS | 4 tes: credential, message, signaling, rate limiter |
| `npm run test:db` server | PASS | 1 tes database aktual: FK, indeks history, UUID tidak ganda, fixture tersimpan, tidak ada sender di luar membership |
| Playwright main workflow | PASS | Register/login API; invalid login; duplicate user; kontak idempotent; direct creation serentak; unauthorized history/write; UUID replay/conflict; sender spoofing |
| Private P2P | PASS | Dua context, channel open; dua arah, emoji/karakter khusus, 3.500+ karakter, multiline, beberapa pesan berurutan, tidak duplikat; GET history diblokir sesudah load awal; log receive khusus DataChannel tetap bertambah |
| File sharing | PASS | 190.000 byte, beberapa chunk, SHA-256 identik, download filename; file kedua; >1.500.000 byte ditolak; hash salah ditolak penerima |
| Voice note | PASS | Chrome dengan fake media device; rekam/stop, chunk terverifikasi, audio readyState ≥2 dan currentTime bertambah saat playback |
| Session/history/reconnect | PASS | Reload satu browser, session tetap login, pesan muncul sekali dari history; pesan baru dua arah tetap melalui channel |
| Grup | PASS | Tiga akun, UI create group, dua channel per anggota, setiap anggota mengirim, penerima tidak duplikat, outsider tidak dapat membaca history |
| Grup anggota offline | PASS | Browser ketiga ditutup; koneksi dibersihkan; pesan ditandai stored; saat browser kembali, history memuat pesan dan mesh terbentuk kembali |
| Network emulation | PASS | Mode offline browser membuat HTTP gagal; lalu page close/reopen menguji departure/rejoin. Emulasi HTTP ini **tidak** membuktikan putusnya transport WebRTC/internet fisik |
| Socket security | PASS | Invalid token ditolak; peer tanpa shared conversation tidak mendapat signal; sender/fromSession diambil dari server; sesi ganda mengganti sesi lama |
| Expired JWT, malformed JSON, oversized JSON | PASS | Respons 401, 400, 413 |
| Mobile dan logout | PASS | 390×844: tombol mulai chat terlihat; logout kembali ke form login |
| Physical microphone permission denied, perangkat mikrofon nyata, codec browser lain | NOT TESTED | Hanya fake microphone Chrome yang diuji |
| Signaling server restart, internet fisik putus/pulih, forced ICE failure | NOT TESTED | Source reconnect/restart diperbaiki, belum ada simulasi terkontrol untuk kasus ini |
| TURN aktif, NAT lintas jaringan, Firefox/Edge/Safari, grup 4–5 orang | NOT TESTED | Runtime verifikasi terbatas Chrome lokal dan grup tiga akun |
| Transfer berhenti di tengah, timeout backpressure, screenshot/visual semua ukuran/tema | NOT TESTED | Batas/cleanup diimplementasikan; belum diuji seluruh variasinya |

Regresi akhir Playwright: **2 passed (13,5 detik)** pada source saat verifikasi. Eksekusi awal sempat FAIL pada reconnect/negosiasi dan toast yang menutup tombol; perbaikan sudah diuji ulang. Tes offline awal mengharapkan CDP memutus WebRTC; asumsi tes diperbaiki dengan memisahkan kegagalan HTTP dari departure peer sebenarnya. Tidak ada FAIL tersisa pada suite final yang dijalankan.

Output terstruktur tersedia setelah menjalankan tes di `client/test-results/results.json`; trace kegagalan tersedia jika tes gagal. Direktori artefak diabaikan Git karena dapat berisi token akun uji dan payload fixture.

## 5. P2P Architecture Verification

1. Login menghasilkan JWT. Socket memverifikasi signature, algoritme dan expiry; identitas pengirim signal tidak diterima dari payload client.
2. Metadata percakapan diambil melalui REST. Hanya user yang berbagi percakapan diizinkan bertukar signaling. ID lebih kecil memulai DataChannel, sedangkan endpoint lain menerima `datachannel`; mekanisme polite/impolite tetap menangani collision negosiasi/restart.
3. SDP offer/answer dipertukarkan melalui event `signal`. Incoming signal diserialisasi; ICE yang datang sebelum remote description masuk queue terbatas. Candidate dengan ufrag sesi lain tidak diterapkan. `fromSession` mencegah PC sesi lama dipakai sesudah browser berganti.
4. `RTCDataChannel.send()` membawa chat, typing, ACK, serta metadata/chunk media. Tidak ada event Socket.IO untuk menyiarkan isi chat. Untuk teks, pengirim menyimpan salinan ke `/api/messages`, lalu mengirim melalui channel kepada anggota aktif.
5. Grup adalah mesh: satu link per pasangan user; link dapat dipakai oleh beberapa percakapan. Setiap payload diperiksa terhadap membership conversation penerima.
6. ACK berarti aplikasi penerima menerima teks atau memverifikasi seluruh media. Delivered grup membutuhkan ACK semua anggota yang diharapkan. Ini bukan read receipt, dan status ACK belum persisten setelah refresh.
7. Statistik rute berasal dari `transport.selectedCandidatePairId`, kemudian kandidat lokal/remote milik pasangan itu. Kandidat relay lain yang tidak dipilih tidak dipakai untuk menyimpulkan rute. DTLS menyediakan enkripsi transport; server tetap dapat membaca salinan teks history. Tidak ada klaim E2EE tingkat aplikasi.

Bukti demo: dua context menerima pesan saat request GET history diblokir; console receiver menampilkan `[NEXA DataChannel receive]` dengan UUID dan peer ID tanpa isi pesan. Tes memeriksa pesan tampil tepat sekali dan status delivered. Monitor menunjukkan channel open dan statistik browser. Refresh digunakan terpisah untuk membuktikan jalur history MySQL.

Acuan teknis yang diperiksa: [W3C WebRTC, perfect negotiation](https://www.w3.org/TR/webrtc/#perfect-negotiation-example), [contoh resmi WebRTC perfect negotiation](https://webrtc.github.io/samples/src/content/peerconnection/perfect-negotiation/). Implementasi menambahkan aturan deterministik pembuat channel agar dua endpoint tidak membuat channel ganda.

## 6. Improvements

- Modul transport yang dapat dibaca terpisah dari UI.
- Identitas sesi dan cleanup koneksi lama; collision handling, ICE queue, ICE restart terbatas serta timeout awal koneksi.
- Monitor selected route dan nilai N/A yang jujur.
- SHA-256, batas metadata/chunk, progress pengiriman lokal, timeout backpressure, penolakan media rusak.
- ACK semua penerima, status stored/sent/partial/error/delivered yang terlihat.
- Validasi API, rate limit in-memory, respons error sesuai, idempotency konflik yang eksplisit.
- Recovery UI, feedback toast, multiline dan penggunaan peer pada mobile.
- Suite tes yang dapat dijalankan ulang tanpa mengganti stack utama.

## 7. Remaining Issues

- STUN saja: tidak ada TURN yang dikonfigurasi. Sebagian NAT/firewall memerlukan TURN; pengujian LAN/localhost tidak menjamin koneksi lintas internet.
- Media hanya berada dalam memori sesi; MySQL menyimpan metadata. Setelah refresh, file/audio lama tidak dapat dipulihkan. Tidak ada mekanisme offline media atau retry/resume chunk.
- History hanya 100 pesan terbaru; belum ada pagination history. Daftar user dibatasi 50 hasil per pencarian. Dialog grup belum memiliki pencarian/pagination anggota tersendiri.
- Grup dibuat dengan 3–5 orang; belum tersedia perubahan membership grup setelah dibuat. Pengujian runtime menggunakan tiga orang.
- Status ACK tidak persisten; delivered bukan read. Pesan offline dibaca melalui REST ketika percakapan dibuka kembali. Belum ada sinkronisasi offline history otomatis ketika chat tetap terbuka atau resend P2P otomatis untuk pesan stored.
- Satu sesi signaling aktif per akun adalah kebijakan demo yang eksplisit. Login tab kedua mengakhiri sesi socket/tab pertama; belum ada routing multi-device.
- Limiter bersifat in-memory per proses, bukan proteksi deployment multi-server. Belum ada refresh-token/revocation server-side, audit deployment publik, atau enkripsi history tingkat aplikasi.
- Belum semua race, error codec, kegagalan ICE, signal server restart, transfer terputus, serta browser dan jaringan fisik diuji; lihat NOT TESTED. Tidak ada klaim aplikasi bebas bug.

## 8. How to Run

Jalankan MySQL/MariaDB XAMPP. Untuk instalasi baru saja, import `server/sql/schema.sql` melalui phpMyAdmin atau MySQL client. Database yang sudah ada tidak perlu dibuat ulang dan tidak membutuhkan migrasi pada perubahan ini.

PowerShell terminal backend, dari folder `nexa-p2p`:

```powershell
cd server
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run dev
```

Pastikan konfigurasi DB dan JWT pada `.env` yang sudah ada benar. Jangan menyalin template menimpa konfigurasi aktif. Backend default `http://localhost:4000`.

Terminal frontend:

```powershell
cd client
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run dev
```

Buka `http://localhost:5173` dengan akun berbeda pada browser/context terpisah. Mikrofon dan Web Crypto memerlukan localhost atau secure context HTTPS; gunakan HTTPS tepercaya untuk demo lintas perangkat.

Tes:

```powershell
cd server
npm run check
npm test
npm run test:db
cd ../client
npm test
npm run build
npm run test:e2e
```

Playwright menggunakan Chrome terpasang (`channel: chrome`), mikrofon sintetis, backend **4010**, dan Vite **5174**. Port harus bebas dan MySQL dengan skema NEXA harus aktif. Proses test membaca `.env` backend tanpa menimpanya. Server aplikasi di 4000 tidak dihentikan. Tes E2E menambahkan fixture ke database yang dikonfigurasi; gunakan salinan database dan `DB_NAME` environment khusus bila ingin memisahkan fixture. Tes database memeriksa fixture dari tes E2E; pada database baru jalankan E2E sebelum `test:db`.

Untuk browser lain, ubah konfigurasi pengujian secara sengaja dan ulangi verifikasi; hasil laporan ini khusus Chrome. JSON/trace disimpan lokal, bukan bahan publikasi.

## 9. Presentation Readiness

- [x] Build, syntax, unit, database, dan Chrome E2E dijalankan.
- [x] Private P2P dua arah dibuktikan tanpa akses history penerima.
- [x] Grup mesh tiga akun, refresh, anggota keluar/kembali, dan history dibuktikan.
- [x] File identik dan penolakan checksum rusak dibuktikan.
- [x] Voice note diterima dan diputar menggunakan mikrofon sintetis.
- [ ] Sebelum presentasi, restart backend/frontend aktif agar memakai source terbaru.
- [ ] Ulangi pada laptop/browser dan jaringan yang akan dipakai di ruang presentasi.
- [ ] Uji mikrofon/perizinan nyata dan speaker perangkat presentasi.
- [ ] Siapkan tiga akun berbeda, satu tab per akun, file kecil, serta MySQL aktif.
- [ ] Tunjukkan monitor dan console DataChannel; bedakan demo P2P dari history database.
- [ ] Jelaskan batas STUN, media sesi, ACK, dan history server secara terbuka.
