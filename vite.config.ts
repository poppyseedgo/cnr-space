import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    target: 'esnext',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-lucide':   ['lucide-react'],
          // ← [2026-04-21] ShaderGradient + three.js 생태계 별도 청크 분리
          //    ShaderBookingButton이 렌더링될 때만 로드됨 (lazy import와 함께 동작)
          //    초기 번들 크기에 영향 주지 않음
          'vendor-shader': [
            '@shadergradient/react',
            '@react-three/fiber',
            'three',
            'three-stdlib',
            'camera-controls',
          ],
        },
      },
    },
  },
})
