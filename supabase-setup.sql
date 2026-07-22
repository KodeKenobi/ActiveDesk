-- Supabase SQL setup for ActiveDesk licensing

-- Create payments table
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  reference TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL, -- 'lifetime', 'weekly', 'monthly'
  amount_usd DECIMAL(10, 2) NOT NULL,
  amount_zar DECIMAL(10, 2),
  status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
  payfast_response JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Create licenses table
CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL,
  issued_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_payments_reference ON payments(reference);
CREATE INDEX idx_payments_email ON payments(email);
CREATE INDEX idx_licenses_email ON licenses(email);
CREATE INDEX idx_licenses_key ON licenses(license_key);

-- Enable RLS
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

-- RLS policies for payments
CREATE POLICY "users_view_own_payments" 
  ON payments FOR SELECT 
  USING (email = current_user_email());

-- RLS policies for licenses
CREATE POLICY "users_view_own_licenses" 
  ON licenses FOR SELECT 
  USING (email = current_user_email());
