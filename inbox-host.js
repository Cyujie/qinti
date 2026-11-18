'use strict';

let previousIncoming = null;
const roomNotices = new Map();

function resetInbox() {
  previousIncoming = null;
  for (const notice of roomNotices.values()) notice.close();
  roomNotices.clear();
  document.getElementById('inboxCount').hidden = true;
  document.title = '青提私信';
}

function attachInbox(frame) {
  frame.addEventListener('qinti-inbox',event=>{
    const owner=frame.dataset.owner;
    if (owner!==currentUser?.id || frame!==chatPanel.firstElementChild) return;
    const {rows,viewing,notify}=event.detail;
    const total=rows.reduce((sum,row)=>sum+row.unread,0);
    const badge=document.getElementById('inboxCount');
    badge.textContent=total>99?'99+':String(total);
    badge.setAttribute('aria-label',total+' 条未读消息');
    badge.hidden=!total;
    document.title=total?'('+total+') 青提私信':'青提私信';
    const next=new Map();
    for(const row of rows){
      next.set(row.room,Math.max(previousIncoming?.get(row.room)||0,row.incoming_seq));
      if(!row.unread){roomNotices.get(row.room)?.close();roomNotices.delete(row.room);continue;}
      if(!notify || !previousIncoming || viewing===row.room || row.incoming_seq<=(previousIncoming.get(row.room)||0))continue;
      try{
        const notice=new Notification('青提私信',{body:'收到新的加密消息',tag:'qinti:'+owner+':'+row.room});
        roomNotices.set(row.room,notice);
        notice.onclick=()=>{
          notice.close();
          if(currentUser?.id!==owner || !frame.isConnected)return;
          window.focus();
          document.getElementById('profileCard').hidden=true;
          selectSection('chat');
          frame.dataset.targetRoom=row.room;
          frame.dispatchEvent(new Event('qinti-open-room'));
        };
      }catch{ /* The browser can revoke notification permission at any time. */ }
    }
    previousIncoming=next;
  });
}
