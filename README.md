# Issue Tracker di Cloudflare Workers

## Deploy (sekali saja)
    npm install
    npx wrangler login
    npx wrangler d1 create issue-tracker        # salin database_id ke wrangler.toml
    npm run db:init                             # buat tabel di D1
    npx wrangler secret put AI_API_KEY          # API key dari Helipod AI Gateway
    npm run deploy

## Domain sendiri
Hapus tanda # pada baris `routes` di wrangler.toml, ganti dengan subdomain kamu, lalu deploy lagi.

## Login
Pilih salah satu:
1. Cloudflare Access (disarankan): Zero Trust > Access > Applications > Add > Self-hosted,
   isi domain, policy "Allow" untuk emailmu. Login pakai kode OTP.
2. Password sederhana: npx wrangler secret put APP_PASSWORD

## Screenshot asli (opsional)
    npx wrangler r2 bucket create issue-screenshots
lalu hapus tanda # pada blok r2_buckets di wrangler.toml dan deploy ulang.

## Tes lokal
    npm run db:init:local
    npx wrangler dev        # isi AI_API_KEY=... di file .dev.vars

## Backup data
    npx wrangler d1 export issue-tracker --remote --output=backup.sql
