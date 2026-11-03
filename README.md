# Issue Tracker (screenshot WA jadi issue)

Upload screenshot chat WhatsApp, AI memisahnya jadi issue satu per satu, lalu kamu
kelola statusnya dan buat laporan akhir shift. Jalan di Cloudflare Workers (gratis
untuk pemakaian pribadi).

## Fitur
- Upload / paste banyak screenshot sekaligus, AI mengekstrak judul, ringkasan, peminta, prioritas, dan deadline.
- Screenshot yang sama tidak diproses dua kali (hemat biaya AI) dan issue kembar dilewati.
- Papan 4 kolom: To Do, In Progress, Blocked, Done. Tombol cepat Mulai / Selesai di kartu.
- Pencarian, filter prioritas dan peminta, tombol "Terlambat saja", penanda umur issue.
- Done hanya menampilkan 36 jam terakhir, sisanya ada di **Arsip** (bisa dicari dan dibuka lagi).
- Riwayat perubahan status dan catatan per issue.
- Laporan Akhir Shift siap tempel ke WA, dan export CSV.
- Screenshot asli disimpan di R2 (opsional) dan ikut terhapus saat issue dihapus.

## Arsitektur
| Bagian | Teknologi |
|---|---|
| Backend | Cloudflare Worker (`src/index.js`) |
| Tampilan | Satu file HTML (`public/index.html`) |
| Database | Cloudflare D1 (SQLite): tabel `issues`, `events`, `shots` |
| Screenshot | R2 (opsional), lewat binding atau S3 API (bisa beda akun) |
| AI | Gateway OpenAI-compatible (default NusaGate, model `glm-5.3-flash`) |

## Kebutuhan
- Node.js **22 atau lebih baru** (Wrangler 4 menolak Node 20). Pasang lewat nvm: `nvm install 22`.
- Akun Cloudflare, akun GitHub, dan API key dari NusaGate (https://nusagate.com, top up mulai Rp 10.000).

## Deploy pertama kali

### 1. Buat database D1
Dashboard Cloudflare > Storage & databases > D1 > Create database, nama **`issue-tracker`**.
Buka tab **Console**, tempel isi `schema.sql`, lalu Execute. Salin **Database ID**-nya.

Isi ke `wrangler.toml`:

    sed -i 's/ISI_SETELAH_d1_create/ID_DATABASE_KAMU/' wrangler.toml
    grep database_id wrangler.toml

### 2. Push ke GitHub
    git init && git add . && git commit -m "first commit"
    git remote add origin git@github.com:USERNAME/REPO.git
    git branch -M main && git push -u origin main

Jalankan `git add .` dari folder utama, bukan dari `src/`, supaya semua file ikut.

### 3. Sambungkan ke Cloudflare
Workers & Pages > Create > Continue with GitHub > pilih repo.
- Project name harus sama dengan `name` di `wrangler.toml` (default `tracker-issue`).
- Build command: kosongkan.
- Deploy command: `npx wrangler deploy`.

Setiap `git push` berikutnya otomatis deploy ulang.

### 4. Pasang secret (lewat terminal)
    npx wrangler login          # pilih akun Cloudflare yang memiliki Worker
    npx wrangler whoami         # pastikan akunnya benar
    npx wrangler secret put AI_API_KEY      # key nsk_... dari NusaGate
    npx wrangler secret put APP_PASSWORD    # password login, minimal 12 karakter

Gunakan `secret put`, bukan variabel biasa di dashboard. Variabel bertipe Text bisa
tertimpa saat deploy dari GitHub dan nilainya terlihat jelas. Jangan pasang di bagian
"Build" pada Settings, karena itu hanya terbaca saat build, bukan saat Worker berjalan.

Jangan biarkan aplikasi tanpa `APP_PASSWORD` (atau Cloudflare Access), karena siapa pun
yang tahu alamatnya bisa memakai saldo AI-mu dan membaca datamu.

### 5. Login
Browser akan meminta login. **Username bebas diisi apa saja** (tidak diperiksa),
yang dicek hanya password-nya. Untuk akses lebih rapi, pakai Cloudflare Access
(Zero Trust > Access > Applications > Self-hosted) dengan policy email-mu saja.

## Screenshot asli di R2 (opsional)
Tanpa R2, aplikasi tetap jalan penuh. Yang hilang hanya tombol **Chat** untuk membuka
screenshot asli.

1. Buat bucket di R2. **Matikan Public Access** di Settings bucket.
2. Buat API token R2 dengan izin Object Read & Write untuk bucket itu.
   Yang dipakai adalah **Access Key ID** (32 karakter heksadesimal) dan
   **Secret Access Key** (64 karakter), bukan "Token value" berawalan `cfat_`.
3. Isi variabel biasa di `wrangler.toml` bagian `[vars]`:

        R2_ACCOUNT_ID = "id-akun-pemilik-bucket"
        R2_BUCKET = "nama-bucket"

4. Pasang dua secret:

        npx wrangler secret put R2_ACCESS_KEY_ID
        npx wrangler secret put R2_SECRET_ACCESS_KEY

Kalau bucket ada di akun yang sama dengan Worker, bisa juga pakai binding:
hapus tanda `#` pada blok `[[r2_buckets]]` di `wrangler.toml`.
Jika upload screenshot gagal, ekstraksi issue tetap berjalan dan penyebabnya tercatat di
tab Logs Worker.

## Ganti penyedia / model AI
Atur di `wrangler.toml` bagian `[vars]`:

    MODEL = "glm-5.3-flash"
    AI_BASE_URL = "https://api.nusagate.com/v1"

Penyedia apa pun yang kompatibel dengan OpenAI Chat Completions dan mendukung input
gambar bisa dipakai. Kalau hasil ekstraksi kurang akurat, coba model lain yang
mendukung gambar, misalnya `gpt-6-luna` atau `gemini-3.8-flash` di NusaGate.
Screenshot dikirim ke penyedia AI, jadi tutup data sensitif sebelum upload.

## Update dari versi lama
Jika database dibuat sebelum v2, jalankan `migrate.sql` **sekali** di Console D1
(menambah kolom `deadline_at` dan tabel `shots`) sebelum men-deploy kode v2.
Error "duplicate column name" berarti kolom itu sudah ada dan aman diabaikan.

## Tes lokal
    npm install
    npx wrangler d1 execute issue-tracker --local --file=schema.sql
    echo 'AI_API_KEY=nsk_xxx' > .dev.vars
    npx wrangler dev

## Backup data
    npx wrangler d1 export issue-tracker --remote --output=backup.sql

## Masalah umum
| Gejala | Penyebab dan solusi |
|---|---|
| Build gagal: `must have a valid database_id` | `database_id` di `wrangler.toml` masih placeholder. Isi dengan ID D1 asli. |
| Build gagal: `Could not resolve aws4fetch` | `package.json` dan `package-lock.json` belum ikut di-commit. Jalankan `git add .` dari folder utama. |
| `Wrangler requires at least Node.js v22` | Pasang Node 22 (`nvm install 22 && nvm use 22`). |
| `AI_API_KEY belum di-set` | Secret belum terpasang di Worker yang benar. Pasang dengan `npx wrangler secret put AI_API_KEY` dan cek `npx wrangler secret list`. |
| Error 402 / `insufficient_balance` | Saldo NusaGate habis. Top up. |
| Error 401 / `invalid_api_key` | Key salah tempel atau dicabut. Pasang ulang. |
| `no such table` atau `no such column` | Schema atau migrasi belum dijalankan di D1. |
| `Permission denied` saat git push | SSH key terdaftar di akun GitHub lain. Pakai key khusus lewat `git config core.sshCommand "ssh -i ~/.ssh/KEY -o IdentitiesOnly=yes"`. |
| Tombol Chat tidak muncul | R2 belum dikonfigurasi, atau token salah. Cek tab Logs Worker. |

## Struktur proyek
    src/index.js       Worker: API, panggilan AI, penyimpanan
    public/index.html  Tampilan
    schema.sql         Skema database untuk instalasi baru
    migrate.sql        Migrasi untuk database lama (v1 ke v2)
    wrangler.toml      Konfigurasi Worker, D1, dan variabel
