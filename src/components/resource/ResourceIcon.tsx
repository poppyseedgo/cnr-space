/**
 * ResourceIcon.tsx — 자원 카테고리 SVG 아이콘 + 자원명 공통 표기 SSOT
 *
 * ✅ 변경 이력
 *  - [2026-08-21] 신규 (미리보기 승인) — "자원명이 나타나는 전역에 'svg ico + 자원명' 공통 표기"
 *
 * 📌 설계
 *  - 아이콘 원본은 resource_categories.icon(text, 20260734 기존 컬럼)에 SVG **원문**으로 저장.
 *    개체(포인터-01 등)는 소속 카테고리 아이콘을 상속 표기한다.
 *  - 렌더는 data-URI <img> — img 컨텍스트의 SVG는 브라우저가 스크립트 실행·외부 리소스를
 *    차단하므로(노쇼 공지 SVG와 동일 원리) sanitizer 없이 구조적으로 안전하다.
 *  - icon 값이 SVG 원문이 아니면(과거 "아이콘 키" 주석 흔적 대비) 렌더하지 않고 텍스트만 —
 *    아이콘 미등록 카테고리와 동일한 하위호환 동작.
 *  - 표기 규칙 변경은 이 파일 1곳만 수정하면 전 표시처에 반영된다.
 *  - 적용 제외 2곳(HTML 제약): <select>/<option>·텍스트 <input> 내부, CSV(텍스트 파일).
 */

import React from 'react'

/** icon 컬럼 값이 렌더 가능한 SVG 원문인지 판정 */
export function isSvgIcon(icon?: string | null): icon is string {
  return !!icon && icon.trimStart().startsWith('<svg')
}

/** SVG 원문 → data URI (UTF-8 — base64보다 짧고 한글 주석도 안전) */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function ResourceIcon({ icon, size = 15, invert = false, style }: {
  icon?:   string | null
  size?:   number
  /** 검정 배경(활성 카테고리 칩) 위에서 흰색 반전 — 미리보기 승인 사양 */
  invert?: boolean
  style?:  React.CSSProperties
}) {
  if (!isSvgIcon(icon)) return null
  return (
    <img
      src={svgDataUri(icon)} alt="" aria-hidden
      width={size} height={size}
      style={{ display: 'inline-block', flexShrink: 0,
               filter: invert ? 'invert(1)' : undefined, ...style }}
    />
  )
}

/** 아이콘 + 이름 한 쌍 — 자원명 표기 전역 공통 래퍼 (아이콘 없으면 텍스트만) */
export function ResourceName({ icon, size = 15, invert = false, gap = 5, style, children }: {
  icon?:    string | null
  size?:    number
  invert?:  boolean
  gap?:     number
  style?:   React.CSSProperties
  children: React.ReactNode
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap, minWidth: 0, ...style }}>
      <ResourceIcon icon={icon} size={size} invert={invert} />
      {children}
    </span>
  )
}
