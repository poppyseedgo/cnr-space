/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', 'sans-serif'],
      },
      // ── C&R SPACE 디자인 토큰 ──────────────────────────────────────────
      colors: {
        // 브랜드
        brand: {
          DEFAULT: '#111111',
          muted:   '#64748B',
        },
        // 상태
        available: { DEFAULT: '#CBECFF', text: '#0369A1' },
        busy:      { DEFAULT: '#FEE2E2', text: '#DC2626' },
        soon:      { DEFAULT: '#FEF3C7', text: '#D97706' },
        pending:   { DEFAULT: '#FEF3C7', text: '#92400E' },
        approved:  { DEFAULT: '#DCFCE7', text: '#16A34A' },
        rejected:  { DEFAULT: '#FEE2E2', text: '#DC2626' },
        // 서피스
        surface: {
          DEFAULT: '#FFFFFF',
          muted:   '#F8FAFC',
          page:    '#F3F4F8',
        },
        // 테두리
        border: {
          DEFAULT: '#E2E8F0',
          strong:  '#CBD5E1',
        },
      },
      // ── 반응형 브레이크포인트 ──────────────────────────────────────────
      screens: {
        xs: '400px',   // 소형 모바일
        sm: '480px',   // 기본 모바일 상한 (isMobile 기준)
        md: '768px',   // 태블릿
        lg: '1024px',  // 데스크탑
        xl: '1280px',  // 와이드
      },
      // ── 타이포그래피 스케일 ──────────────────────────────────────────
      fontSize: {
        '2xs': ['10px', { lineHeight: '1.4' }],
        'xs':  ['11px', { lineHeight: '1.4' }],
        'sm':  ['12px', { lineHeight: '1.5' }],
        'md':  ['13px', { lineHeight: '1.5' }],
        'base':['14px', { lineHeight: '1.6' }],
        'lg':  ['15px', { lineHeight: '1.6' }],
        'xl':  ['16px', { lineHeight: '1.6' }],
        '2xl': ['18px', { lineHeight: '1.4' }],
        '3xl': ['20px', { lineHeight: '1.3' }],
      },
      // ── 간격 토큰 ──────────────────────────────────────────────────
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      // ── 그림자 ──────────────────────────────────────────────────
      boxShadow: {
        'card':    '0 2px 8px rgba(0,0,0,0.06)',
        'card-lg': '0 8px 32px rgba(0,0,0,0.10)',
        'modal':   '0 20px 60px rgba(0,0,0,0.15)',
        'dropdown':'0 8px 32px rgba(0,0,0,0.12)',
      },
      // ── 라운드 ──────────────────────────────────────────────────
      borderRadius: {
        'xs':  '6px',
        'sm':  '8px',
        'md':  '10px',
        'lg':  '12px',
        'xl':  '14px',
        '2xl': '16px',
        '3xl': '20px',
      },
    },
  },
  plugins: [],
}
