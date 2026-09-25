import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// GitHub project Pages serve from /<repo>/.
const base = process.env.VITE_BASE ?? '/rebound/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
})
