// Bundles and runs the smoke test. Wired into `npm run build`.
import { execSync } from 'node:child_process';
const DEF = "--define:import.meta.env.VITE_SUPABASE_URL='\"https://x.supabase.co\"' "
          + "--define:import.meta.env.VITE_SUPABASE_ANON_KEY='\"anon\"' "
          + "--define:__BUILD_ID__='\"test\"' --define:__APP_VERSION__='\"test\"'";
execSync(`npx esbuild test/smoke.jsx --bundle --platform=node --format=cjs --jsx=automatic --outfile=node_modules/.smoke.cjs ${DEF}`,
  { stdio: 'inherit' });
execSync('node node_modules/.smoke.cjs', { stdio: 'inherit' });

// Parser regression tests, run against fixtures taken from real bank exports
execSync('node test/parsers.mjs', { stdio: 'inherit' });
