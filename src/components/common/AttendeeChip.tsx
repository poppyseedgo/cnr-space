import { X } from 'lucide-react'
import { UserAvatar } from './UserAvatar'

interface AttendeeChipProps {
  name:        string
  avatarUrl?:  string | null
  dept?:       string        // 있으면 흐린 텍스트로 표시
  onRemove?:   () => void    // 있으면 X 버튼 (BookingModal 전용)
  avatarSize?: number        // default 18
}

/**
 * AttendeeChip
 * 참석자 pill 형태 공통 컴포넌트
 * [아바타] 이름  부서  [X]
 *
 * - onRemove 없으면 읽기 전용 (DetailModal, BookingDoneModal)
 * - onRemove 있으면 제거 버튼 표시 (BookingModal)
 */
export function AttendeeChip({ name, avatarUrl, dept, onRemove, avatarSize = 18 }: AttendeeChipProps) {
  return (
    <div style={{
      display:     'inline-flex',
      alignItems:  'center',
      gap:         5,
      background:  '#EEF2FF',
      color:       '#000',
      fontSize:    11,
      fontWeight:  600,
      padding:     onRemove ? '4px 10px 4px 6px' : '4px 10px 4px 6px',
      borderRadius: 999,
    }}>
      <UserAvatar name={name} avatarUrl={avatarUrl ?? null} size={avatarSize} bgColor="#3D88FF" />
      <span>{name}</span>
      {dept && (
        <span style={{ color: 'rgba(0,0,0,0.38)', fontSize: 10, fontWeight: 400 }}>{dept}</span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          style={{
            background:  'none',
            border:      'none',
            cursor:      'pointer',
            color:       '#CBD5E1',
            lineHeight:  1,
            padding:     0,
            marginLeft:  2,
            display:     'flex',
            alignItems:  'center',
          }}
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
