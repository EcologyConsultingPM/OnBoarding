#!/usr/bin/env bash
set -euo pipefail

# Run from the extracted OnBoarding project folder.
# Do not commit .env.local or paste the service-role key into source files.

cat > .env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://mqgumjgotjiphfgqdyyl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=PASTE_YOUR_SUPABASE_ANON_KEY_HERE
SUPABASE_SERVICE_ROLE_KEY=PASTE_YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE
EOF

npm install
npm run build

git status
git remote -v

# Only run the next command if no origin remote is listed above.
# git remote add origin https://github.com/EcologyConsultingPM/OnBoarding.git

git add . ':!.env.local'
git commit -m "feat: update Ecology Consulting onboarding portal"
git push origin main

# Install once if the Vercel CLI is not already available:
# npm install --global vercel

# Link the folder to the existing Vercel project if prompted.
vercel link

# Add the same three values from .env.local in the Vercel dashboard for
# Production, Preview and Development before deploying. Alternatively use:
# vercel env add NEXT_PUBLIC_SUPABASE_URL production
# vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
# vercel env add SUPABASE_SERVICE_ROLE_KEY production

# Build and deploy the current branch to production.
vercel --prod

# Confirm the live deployment and domain.
vercel ls
