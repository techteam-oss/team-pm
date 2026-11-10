import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the same build works on GitHub Pages (/team-pm/), Cloudflare Pages (/) or any subpath.
export default defineConfig({
  base: './',
  plugins: [react()],
})
