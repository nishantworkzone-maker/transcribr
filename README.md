# Transcribr

AI-powered audio transcription. Static HTML + Vercel serverless functions.

## Deploy (Git → Vercel)

```bash
git add .
git commit -m "update"
git push
```

Vercel auto-deploys on every push. No build step. No npm install needed locally.

## Environment Variables (Vercel Dashboard only)

Go to: Vercel Dashboard → Your Project → Settings → Environment Variables

Add these:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase public anon key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (for server-side DB writes) |
| `GROQ_API_KEY` | Groq API key (Fast mode — Whisper) |
| `DEEPGRAM_API_KEY` | Deepgram API key (Smart/Balanced mode) |
| `ASSEMBLYAI_API_KEY` | AssemblyAI API key (Precision/Accurate mode — Pro users) |

**No .env file needed. No local setup needed.**

## Architecture

- `*.html` — Static pages served by Vercel CDN
- `api/config.js` — Returns Supabase public keys to frontend
- `api/transcribe.js` — Transcription endpoint (Groq / Deepgram / AssemblyAI)
- `api/audio.js` — Audio proxy for cross-origin playback
- `server.js` — Express app handling remaining /api/* routes (translate, user, etc.)

## Contact

nishant.workzone@gmail.com
