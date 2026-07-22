# ActiveDesk License Delivery (Email-Based)

## Simple Flow

1. **User pays via PayFast** with their email
2. **User visits dashboard.html**
3. **Enters same email**
4. **License key is generated** (or retrieved if already exists)
5. **Key displays with copy button**
6. **Done!**

No reference numbers, no verification needed. Just email.

---

## Setup (5 Minutes)

### 1. Supabase Project

Go to [supabase.com](https://supabase.com) → Create project → Save URL & Anon Key

### 2. Create Table

Supabase → SQL Editor → Run:

```sql
CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL,
  issued_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP
);

CREATE INDEX idx_licenses_email ON licenses(email);
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone_insert" ON licenses FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone_select" ON licenses FOR SELECT USING (true);
```

### 3. Deploy Function

Supabase → Edge Functions → New: `generate-license`

Paste: `supabase/functions/generate-license/index.ts`

Add env variable:
```
LICENSE_PRIVATE_KEY = your_rsa_private_key_here
```

Deploy.

### 4. Update Dashboard

Edit `docs/dashboard.html`:

```javascript
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```

Get from: Supabase Dashboard → Settings → API

---

## User Instructions

1. Buy on landing page (they enter email)
2. Go to `your-site.com/dashboard.html`
3. Enter same email
4. Key appears instantly
5. Copy → paste into ActiveDesk

**That's it!**

