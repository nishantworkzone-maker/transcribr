-- supabase/schema.sql
-- Run this in your Supabase SQL Editor to create the required tables
-- Go to: supabase.com → your project → SQL Editor → New query → paste this → Run

-- ─────────────────────────────────────────
-- Table 1: subscriptions
-- Stores each user's plan (free, pro, premium)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',         -- 'free' | 'pro' | 'premium'
  stripe_customer_id text,
  stripe_subscription_id text,
  valid_until timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
-- Table 2: usage
-- Records every transcription a user does
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  engine text NOT NULL,                      -- 'groq' | 'deepgram' | 'assemblyai'
  duration_seconds integer DEFAULT 0,
  title text DEFAULT 'Untitled',
  created_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
-- Table 3: transcripts
-- Stores the full transcript text and metadata
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transcripts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text DEFAULT 'Untitled',
  transcript text,                           -- original transcript
  masked_transcript text,                    -- PII-masked version
  audio_url text,                            -- original audio URL if imported
  engine text,                               -- which engine was used
  language text DEFAULT 'en',
  pii_detected boolean DEFAULT false,
  speaker_count integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
-- Row Level Security (RLS)
-- This ensures users can ONLY see their own data
-- ─────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;

-- Subscriptions: users can only see/edit their own row
CREATE POLICY "Users see own subscription" ON public.subscriptions
  FOR ALL USING (auth.uid() = user_id);

-- Usage: users can only see their own usage rows
CREATE POLICY "Users see own usage" ON public.usage
  FOR ALL USING (auth.uid() = user_id);

-- Transcripts: users can only see/edit their own transcripts
CREATE POLICY "Users see own transcripts" ON public.transcripts
  FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- Auto-create a 'free' subscription when a new user signs up
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan)
  VALUES (NEW.id, 'free')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger that fires after a new user is created
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
