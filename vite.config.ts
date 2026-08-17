import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command, mode }) => {
  // Determine HMR configuration based on environment
  let hmrConfig: any = true;

  if (process.env.DISABLE_HMR === 'true') {
    hmrConfig = false;
  } else if (process.env.CODESPACE_NAME && process.env.CODESPACES === 'true') {
    // For GitHub Codespaces:
    // When accessed via Codespaces preview URL like https://codespace-name-PORT.preview.app.github.dev/
    // The browser needs to connect HMR to the SAME port it loaded the page from.
    // We use browser's window.location to auto-detect the correct port through Codespaces port forwarding.
    // This avoids hardcoding a specific port that might not match where Vite actually runs.
    hmrConfig = {
      protocol: 'wss', // Use WebSocket Secure for HTTPS-accessed Codespaces URLs
      // Omit host and port - let the Vite HMR client use window.location to auto-detect.
      // This ensures it connects to the same domain/port the page was loaded from.
    };
  }

  // Load env variables from files and merge with process.env
  const fileEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const envDefine: Record<string, any> = {};
  
  // Collect all VITE_ variables from process.env and fileEnv
  const allKeys = new Set([
    ...Object.keys(process.env).filter(k => k.startsWith('VITE_')),
    ...Object.keys(fileEnv).filter(k => k.startsWith('VITE_'))
  ]);

  for (const key of allKeys) {
    const val = process.env[key] || fileEnv[key] || '';
    envDefine[`import.meta.env.${key}`] = JSON.stringify(val);
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico'],
        manifest: {
          name: 'Academy Connect',
          short_name: 'Academy',
          description: 'Academy Connect Tuition Management',
          theme_color: '#2563eb',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
        },
      }),
    ],
    define: envDefine,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      hmr: hmrConfig,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Enable CORS for Codespaces forwarded URLs
      cors: true,
    },
  };
});
