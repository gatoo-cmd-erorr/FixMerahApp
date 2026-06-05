# FixMerah Email API

API untuk send email, track email, cek reply via IMAP, dan Mail Meteor (kirim massal max 5 nomor).

---

## 📁 Struktur Folder

```
fixmerah-api/
├── api/
│   ├── send-email.js      ← Kirim 1 email + auto tracking
│   ├── check-reply.js     ← Cek balasan via IMAP
│   ├── tracking.js        ← List tracking + mark notified
│   ├── mail-meteor.js     ← Kirim ke max 5 nomor sekaligus
│   └── health.js          ← Cek status Mongo + SMTP + IMAP
├── lib/
│   ├── db.js              ← MongoDB helpers
│   └── auth.js            ← API key middleware
├── package.json
├── vercel.json
└── README.md
```

---

## ⚙️ Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Deploy ke Vercel
```bash
vercel --prod
```

### 3. Set Environment Variables di Vercel Dashboard

| Variable       | Contoh                                              |
|----------------|-----------------------------------------------------|
| `API_KEY`      | `fixmerah-secret-key-2024`                          |
| `MONGODB_URI`  | `mongodb+srv://user:pass@cluster.mongodb.net/`      |
| `MONGODB_DB`   | `fixmerah` *(opsional, default: fixmerah)*          |

---

## 🗃️ Setup MongoDB

Buat collection `gmail_accounts` dan isi dengan akun Gmail kamu:

```json
[
  {
    "id": 1,
    "user": "akunmu@gmail.com",
    "pass": "app-password-16-digit",
    "active": true,
    "addedAt": 1700000000000
  }
]
```

> **Penting:** Gunakan **App Password** Gmail (16 digit), bukan password utama.
> Gmail → Manage Account → Security → 2-Step Verification → App Passwords

---

## 📡 Endpoint API

### Auth
Semua endpoint butuh header:
```
X-API-Key: your-api-key
```
atau query: `?api_key=your-api-key`

---

### POST `/api/send-email`
Kirim 1 email + simpan ke tracking.

**Body:**
```json
{
  "to_email": "target@gmail.com",
  "subject": "Subject Email",
  "body": "<b>Isi email HTML</b> atau plain text",
  "nomor": "081234567890",
  "user_id": "123",
  "sender_email": "optional@gmail.com",
  "sender_pass": "optional-app-pass"
}
```

**Response:**
```json
{
  "ok": true,
  "tracking_id": "GABRIEL-20240101-1234",
  "message_id": "<xxx@gmail.com>",
  "sender": "akun@gmail.com",
  "to": "target@gmail.com",
  "subject": "Subject Email"
}
```

---

### POST `/api/check-reply`
Scan IMAP untuk cek balasan email yang sudah dikirim.

**Body:**
```json
{
  "tracking_ids": ["GABRIEL-20240101-1234", "GABRIEL-20240101-5678"]
}
```
> Kosongkan `tracking_ids` untuk cek semua pending.

**Response:**
```json
{
  "ok": true,
  "checked": 5,
  "replies_found": [
    {
      "tracking_id": "GABRIEL-20240101-1234",
      "from": "support@example.com",
      "subject": "Re: Subject Email",
      "preview": "Terima kasih sudah menghubungi...",
      "appeal_id": "TICKET-12345",
      "replied_at": "Senin, 01 Januari 2024 12:00:00"
    }
  ]
}
```

---

### GET `/api/tracking`
List data tracking dengan filter.

**Query params:**
- `user_id` — filter by user
- `nomor` — filter by nomor HP
- `status` — `sent` | `reply_detected`
- `reply_detected` — `true` | `false`
- `tracking_id` — cari spesifik
- `limit` — max 100, default 20

**Contoh:** `GET /api/tracking?user_id=123&reply_detected=true`

### POST `/api/tracking`
Mark tracking sebagai sudah dinotifikasi.

**Body:**
```json
{
  "action": "mark-notified",
  "tracking_id": "GABRIEL-20240101-1234"
}
```

---

### POST `/api/mail-meteor`
Kirim email ke 1 target dengan **max 5 nomor berbeda** (untuk perbandingan massal).

**Body:**
```json
{
  "nomors": ["08111", "08222", "08333", "08444", "08555"],
  "to_email": "target@gmail.com",
  "subject": "Appeal untuk nomor {nomor}",
  "body": "Halo, ini appeal untuk nomor <b>{nomor}</b>",
  "user_id": "123"
}
```
> Gunakan `{nomor}` sebagai placeholder di subject dan body.

**Response:**
```json
{
  "ok": true,
  "summary": { "total": 5, "sent": 5, "failed": 0 },
  "results": [
    {
      "nomor": "08111",
      "nomor_normalized": "+6208111",
      "tracking_id": "GABRIEL-20240101-1111",
      "message_id": "<xxx@gmail.com>",
      "sender": "akun@gmail.com",
      "status": "sent",
      "error": null
    }
  ],
  "note": "5 email terkirim. Gunakan /api/check-reply untuk cek balasan."
}
```

---

### GET `/api/health`
Cek status koneksi semua service.

**Response:**
```json
{
  "ok": true,
  "status": {
    "mongo": true,
    "smtp": true,
    "imap": true,
    "accounts_active": 33,
    "test_account": "akun@gmail.com"
  }
}
```

---

## 🔄 Alur Kerja Normal

```
1. POST /api/send-email  →  dapat tracking_id
2. (tunggu beberapa jam)
3. POST /api/check-reply →  cek apakah ada balasan
4. GET  /api/tracking    →  lihat status semua email
5. POST /api/tracking    →  mark-notified setelah notif dikirim ke user
```

## 🔄 Alur Mail Meteor

```
1. POST /api/mail-meteor  →  kirim ke 5 nomor, dapat 5 tracking_id
2. POST /api/check-reply  →  kirim semua tracking_id untuk cek balasan
3. GET  /api/tracking     →  bandingkan: nomor mana yang dapat balasan
```

---

## ⚠️ Catatan Penting

- Vercel timeout 30 detik → `/api/check-reply` punya internal guard 25 detik
- Gmail SMTP butuh **App Password** (bukan password biasa)
- Aktifkan **2-Factor Authentication** di Gmail sebelum buat App Password
- MongoDB gratis: gunakan [MongoDB Atlas](https://mongodb.com/atlas)
