// ─────────────────────────────────────────────────────────────────────────────
// ShaderBookingButton - 홈화면 "오늘 내 예약" 섹션의 "+ 예약하기" 버튼
// ─────────────────────────────────────────────────────────────────────────────
// [생성 이력]
// 2026-04-21: 최초 생성.
//   - 목적: 기존 검정(#111111) 배경 버튼을 ShaderGradient(3D 그라데이션)로 교체
//   - 적용 범위: "오늘 내 예약" 섹션의 "+ 예약하기" 버튼 **1개만**
//   - 디자이너 원칙:
//       · 글자 주변 text-shadow 금지
//       · 적용 영역에 어두운 overlay 금지
//       · shader gradient 본연의 색감을 그대로 유지
//
// 2026-04-21 (타입 수정): 사용자가 shadergradient.co 에서 복사한 프롭스 중
//   실제 @shadergradient/react@2.4.20 의 GradientT/MeshT 타입에 존재하지 않는
//   프롭스 8개를 제거 (TS2322 에러 해결).
//   - 제거: axesHelper, bgColor1, bgColor2, destination, embedMode, format,
//           frameRate, gizmoHelper
//   - 이유: 이 프롭스들은 Framer/Figma 플러그인 전용 컨트롤이거나,
//           shadergradient.co 커스터마이저 UI의 상태값으로만 사용됨.
//           React 컴포넌트의 실제 렌더링에는 영향 없음 (타입 정의에서 제외됨).
//   - 검증: node_modules/@shadergradient/react/dist/index.d.mts 의
//           GradientT & MeshT 타입 정의와 직접 대조하여 모든 남은 프롭스가
//           타입에 존재함을 확인.
//
// [설계 원칙]
// 1. 기존 <button> 태그 구조/onClick/접근성 100% 유지
//    - Canvas는 pointer-events:none 으로 클릭 이벤트 간섭 차단
// 2. ShaderGradient 파라미터는 사용자가 shadergradient.co 에서 세팅한 값 중
//    타입에 존재하는 것만 사용 (시각적 결과는 동일)
// 3. 번들 영향 최소화:
//    - 이 파일 자체는 ShaderGradient를 직접 import 하므로, HomeView에서 React.lazy로 로드
// 4. 성능:
//    - pixelDensity={1} (ShaderGradientCanvas에 전달 - 이 컴포넌트의 prop)
//    - 버튼 1개 인스턴스만 렌더링 → WebGL 컨텍스트 1개 (안전)
// ─────────────────────────────────────────────────────────────────────────────

import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react'

interface ShaderBookingButtonProps {
  onClick: () => void
  isMobile: boolean
}

export function ShaderBookingButton({ onClick, isMobile }: ShaderBookingButtonProps) {
  // 기존 HomeView.tsx 스펙 그대로 유지 (가로 × 세로)
  const W = isMobile ? 150 : 170
  const H = isMobile ? 140 : 160

  return (
    <button
      onClick={onClick}
      className="btn flex-none flex flex-col items-center justify-center rounded-3xl text-white font-medium"
      style={{
        width: W,
        height: H,
        flexShrink: 0,
        gap: 8,
        // ── [핵심] ShaderGradient 영역 기준점 + border-radius 밖으로 그라데이션 삐져나옴 방지
        position: 'relative',
        overflow: 'hidden',
        // fallback 배경 (ShaderGradient 로딩 전 또는 실패 시 기존 검정 유지)
        background: '#111111',
        // 버튼 자체에 border 없음 유지
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {/* ① ShaderGradient 레이어 ──────────────────────────────────────────
          - absolute 로 버튼 전체 덮음
          - pointer-events:none → 버튼 onClick 이벤트 가로채지 않음
          - zIndex 0 (아래 레이어) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          borderRadius: 'inherit', // 버튼의 rounded-3xl(1.5rem) 상속 → 모서리 자연스럽게 깎임
          overflow: 'hidden',
        }}
        aria-hidden="true"
      >
        <ShaderGradientCanvas
          style={{
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
          pixelDensity={1}
          fov={45}
        >
          {/* ← [중요] 아래 프롭스는 @shadergradient/react@2.4.20 의 GradientT 타입에
                     실제로 정의된 프롭스만 사용. shadergradient.co 에서 복사한 프롭스 중
                     axesHelper/bgColor1/bgColor2/destination/embedMode/format/frameRate/
                     gizmoHelper 는 타입에 없으므로 제거됨 (시각적 결과 동일). */}
          <ShaderGradient
            animate="on"
            brightness={0.8}
            cAzimuthAngle={270}
            cDistance={0.5}
            cPolarAngle={180}
            cameraZoom={15.1}
            color1="#73bfc4"
            color2="#ff810a"
            color3="#8da0ce"
            envPreset="city"
            grain="on"
            lightType="env"
            positionX={-0.1}
            positionY={0}
            positionZ={0}
            range="disabled"
            rangeStart={0}
            rangeEnd={40}
            reflection={0.4}
            rotationX={0}
            rotationY={130}
            rotationZ={70}
            shader="defaults"
            type="sphere"
            uAmplitude={3.2}
            uDensity={0.8}
            uFrequency={5.5}
            uSpeed={0.3}
            uStrength={0.3}
            uTime={0}
            wireframe={false}
          />
        </ShaderGradientCanvas>
      </div>

      {/* ② 텍스트 레이어 ──────────────────────────────────────────────────
          - relative + zIndex 1 → 그라데이션 위에 올라감
          - text-shadow 없음 (디자이너 원칙 준수)
          - overlay 없음 (디자이너 원칙 준수) */}
      <span style={{ position: 'relative', zIndex: 1, fontSize: 24, lineHeight: 1 }}>＋</span>
      <span style={{ position: 'relative', zIndex: 1, fontSize: isMobile ? 12 : 13 }}>예약하기</span>
    </button>
  )
}
