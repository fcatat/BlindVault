import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const apiBase = process.env.VITE_API_BASE || 'http://localhost:8000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // 代理后端 API
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
        },
        '/health': {
          target: apiBase,
          changeOrigin: true,
        },
      },
    },
  };
});
