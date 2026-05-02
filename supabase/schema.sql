-- ============================================================
-- TRANSCRIBR — Full Schema
-- Run this in: supabase.com → your project → SQL Editor → New Query
-- Safe to run multiple times (uses IF NOT EXISTS)
-- ============================================================

-- TABLE 1: subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  valid_until timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- TABLE 2: usage
CREATE TABLE IF NOT EXISTS public.usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  engine text NOT NULL,
  duration_seconds integer DEFAULT 0,
  title text DEFAULT 'Untitled',
  created_at timestamptz DEFAULT now()
);

-- TABLE 3: transcripts
CREATE TABLE IF NOT EXISTS public.transcripts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text DEFAULT 'Untitled',
  transcript text,
  masked_transcript text,
  audio_url text,
  engine text,
  language text DEFAULT 'en',
  pii_detected boolean DEFAULT false,
  speaker_count integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- ROW LEVEL SECURITY
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users see own usage" ON public.usage;
DROP POLICY IF EXISTS "Users see own transcripts" ON public.transcripts;

CREATE POLICY "Users see own subscription" ON public.subscriptions
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own usage" ON public.usage
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own transcripts" ON public.transcripts
  FOR ALL USING (auth.uid() = user_id);

-- AUTO-CREATE free subscription on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan)
  VALUES (NEW.id, 'free')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill existing users
INSERT INTO public.subscriptions (user_id, plan)
SELECT id, 'free' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
