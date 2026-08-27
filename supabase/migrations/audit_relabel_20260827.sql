-- 2026-08-27 13:00:03 KST 사고 — 가드에 막혀 실제 미반영된 9건의 audit_log 를 재표기 (감사 오염 해소)
-- SDV 교육(b1785108574121_0) 1건은 실제 반영됐으므로 BOOKING_NOSHOW 유지, 13:19 수동 복구 이력을 별도 행으로 남김
UPDATE audit_log
   SET action = 'BOOKING_NOSHOW_REJECTED'
 WHERE action = 'BOOKING_NOSHOW'
   AND created_at BETWEEN '2026-08-27T04:00:00Z' AND '2026-08-27T04:00:10Z'
   AND entity_id <> 'b1785108574121_0';

INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, before_data, after_data, created_at)
SELECT actor_id, 'admin(manual)', 'BOOKING_NOSHOW_REVERTED', entity_type, entity_id,
       '{"autoCancelled": true, "cancelledBy": "system"}'::jsonb,
       '{"autoCancelled": false, "checkedIn": true, "reason": "premature noshow by client tick (attendee browser, 13:00:03) — manually restored 13:19"}'::jsonb,
       '2026-08-27T04:19:16Z'
  FROM audit_log
 WHERE action='BOOKING_NOSHOW' AND entity_id='b1785108574121_0'
   AND created_at BETWEEN '2026-08-27T04:00:00Z' AND '2026-08-27T04:00:10Z'
   AND NOT EXISTS (SELECT 1 FROM audit_log WHERE action='BOOKING_NOSHOW_REVERTED' AND entity_id='b1785108574121_0');
