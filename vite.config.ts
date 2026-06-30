import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // /viewer パスをindex.htmlにフォールバック（SPA routing）
  build: {
    // 本番ではソースマップを出力しない（ソースコード保護・M-6）
    sourcemap: false,
    rollupOptions: {
      input: { main: './index.html' }
    }
  },
})
