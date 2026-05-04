/**
 * NotificationBell.tsx — 헤더 알림 벨 + 알림 패널
 *
 * ✅ 변경 이력
 *  - [2026-05-04] App.tsx에서 분리 (Phase 1+2 Step 3)
 *      · App.tsx 영역 통합 이동:
 *        - state: notifications, showNotifPanel
 *        - ref: notifRef
 *        - useEffect: load + Realtime subscribe (인증 의존)
 *        - useEffect: 외부 클릭 닫기
 *        - JSX: 알림 벨 + 미읽음 배지 + 알림 패널 (헤더/목록/모두읽음)
 *      · 인라인 typeColors 객체 → src/data/notificationMeta.ts로 분리
 *      · 동작 로직 무수정 — 자기완결적 컴포넌트
 *
 * 핵심 동작 (메모리 기반):
 *  · authUser 확정 → loadNotifications + Realtime 구독 시작
 *  · payload.new 수신 시 즉시 prepend (Edge Function insert <100ms 반영)
 *  · payload.new 없으면 loadNotifications 재호출 (UPDATE 이벤트 등)
 *  · authUser 변경 시 unsub + 재구독 (다른 계정으로 로그인)
 *  · 알림 클릭 → markNotificationRead + booking 모달 오픈 (booking_id 있을 때)
 *  · "모두 읽음" → markAllNotificationsRead + 일괄 is_read=true
 *
 * Props:
 *  - authUser              : Realtime 구독용 user_id 접근
 *  - dark                  : 다크 모드
 *  - onOpenBookingDetail   : 부모 setModal 위임 (booking 검색은 부모가 책임)
 */

import { useState, useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import {
  loadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeNotifications,
  type AppNotification,
} from '../../lib/api'
import { getNotificationColor } from '../../data/notificationMeta'

interface NotificationBellProps {
  authUser: { user_id: string } | null;
  dark: boolean;
  onOpenBookingDetail: (bookingId: string) => void;
}

export function NotificationBell({
  authUser,
  dark,
  onOpenBookingDetail,
}: NotificationBellProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((n: AppNotification) => !n.is_read).length;

  // 알림 로드 + Realtime 구독 (인증 의존)
  // - authUser null → 알림 비우기 (로그아웃)
  // - authUser 확정 → loadNotifications + subscribeNotifications
  // - authUser 변경 시 unsub → 재구독 (다른 계정 로그인)
  useEffect(() => {
    if (!authUser) { setNotifications([]); return; }
    loadNotifications().then(setNotifications);
    const unsub = subscribeNotifications((payload) => {
      // payload.new 에서 직접 새 알림 추가 — Edge Function insert 즉시 반영
      if (payload?.new) {
        const n = payload.new;
        setNotifications(prev => [{
          id:         n.id,
          user_id:    n.user_id,
          type:       n.type,
          title:      n.title,
          body:       n.body ?? '',
          booking_id: n.booking_id ?? null,
          is_read:    false,
          created_at: n.created_at,
        } as AppNotification, ...prev]);
      } else {
        loadNotifications().then(setNotifications);
      }
    }, authUser.user_id);
    return unsub;
  }, [authUser?.user_id]);

  // 외부 클릭 시 패널 닫기 (자기완결)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifPanel(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={notifRef} style={{position:"relative"}}>
      <button className="btn" onClick={()=>setShowNotifPanel(v=>!v)}
        style={{position:"relative",width:36,height:36,borderRadius:"50%",
          display:"flex",alignItems:"center",justifyContent:"center",
          background:showNotifPanel?(dark?"rgba(255,255,255,0.1)":"#F1F5F9"):"transparent",
          color:dark?"#94A3B8":"#64748B"}}>
        <Bell size={18} strokeWidth={1.8}/>
        {unreadCount > 0 && (
          <span style={{position:"absolute",top:4,right:4,
            background:"#EF4444",color:"#fff",
            fontSize:9,fontWeight:600,borderRadius:999,
            padding:"1px 4px",lineHeight:1.4,minWidth:14,textAlign:"center"}}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* 알림 패널 */}
      {showNotifPanel && (
        <div className="anm" style={{
          position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:300,
          background:"#fff",border:"1px solid #E2E8F0",borderRadius:16,
          boxShadow:"0 8px 32px rgba(0,0,0,0.12)",width:340,overflow:"hidden"}}>

          {/* 패널 헤더 */}
          <div style={{padding:"14px 16px",borderBottom:"1px solid #F1F5F9",
            display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:14,fontWeight:600,color:"#111"}}>
              알림 {unreadCount > 0 && <span style={{color:"#EF4444",fontSize:12}}>({unreadCount})</span>}
            </span>
            {unreadCount > 0 && (
              <button className="btn" onClick={()=>{
                markAllNotificationsRead()
                setNotifications(prev => prev.map(n => ({...n, is_read:true})))
              }} style={{fontSize:11,color:"#64748B",padding:"2px 8px",borderRadius:6,
                border:"1px solid #E2E8F0",background:"#F8FAFC"}}>
                모두 읽음
              </button>
            )}
          </div>

          {/* 알림 목록 */}
          <div style={{maxHeight:400,overflowY:"auto"}}>
            {notifications.length === 0 ? (
              <div style={{padding:"40px 0",textAlign:"center",color:"#94A3B8",fontSize:13}}>
                알림이 없습니다
              </div>
            ) : notifications.map(n => {
              const color = getNotificationColor(n.type)
              return (
                <div key={n.id}
                  onClick={()=>{
                    if (!n.is_read) {
                      markNotificationRead(n.id)
                      setNotifications(prev => prev.map(x => x.id===n.id ? {...x,is_read:true} : x))
                    }
                    if (n.booking_id) onOpenBookingDetail(n.booking_id)
                    setShowNotifPanel(false)
                  }}
                  style={{padding:"12px 16px",borderBottom:"1px solid #F8FAFC",cursor:"pointer",
                    background:n.is_read?"transparent":"#F0F9FF",transition:"background 0.15s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                  onMouseLeave={e=>e.currentTarget.style.background=n.is_read?"transparent":"#F0F9FF"}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                    <div style={{width:6,height:6,borderRadius:"50%",
                      background:n.is_read?"transparent":color,
                      marginTop:6,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      {/* 알림 제목 (상태 메시지) */}
                      <div style={{fontSize:13,fontWeight:n.is_read?400:600,color:"#111",
                        marginBottom:3}}>{n.title}</div>
                      {/* body 파싱: "회의제목 · 회의실 · 날짜 오전/오후 H:MM" */}
                      {n.body && (() => {
                        const parts = n.body.split(' · ')
                        return (
                          <div style={{display:"flex",flexDirection:"column",gap:1}}>
                            {parts[0] && <div style={{fontSize:12,fontWeight:600,color:"#374151",
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{parts[0]}</div>}
                            {parts.slice(1).map((p,i) => (
                              <div key={i} style={{fontSize:11,color:"#64748B"}}>{p}</div>
                            ))}
                          </div>
                        )
                      })()}

                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  );
}
