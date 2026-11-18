import {makeRecoveryCode,recoveryKey,sealRoom,restoreRoom,encryptLabel,decryptLabel} from './chat-recovery.js';
import { MAX_FILE_SIZE, prepareFile, uploadFile, renderFile } from './chat-media.js';
const api = 'https://uomgorcvmqodmfnxovri.supabase.co';
const publishableKey = 'sb_publishable_udvGflXSwMiribxIMmNlew_dZUD3Ng1';
const el = id => document.getElementById(id);
const say = value => { el(active ? 'status' : 'intro').textContent = value; };
const list = el('messages');
const options = el('options');
function nearLatest() {
  return list.scrollHeight - list.clientHeight - list.scrollTop < 48;
}
function scrollToLatest() {
  list.scrollTop = list.scrollHeight;
  el('latest').hidden = true;
}
el('latest').onclick = scrollToLatest;
list.addEventListener('scroll', () => { el('latest').hidden = nearLatest(); });
document.addEventListener('click', e => {
  if (!options.contains(e.target) || e.target.closest('.menu button')) options.open = false;
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && options.open) {
    options.open = false;
    options.querySelector('summary').focus();
  }
});
const hex = data => Array.from(new Uint8Array(data), b => b.toString(16).padStart(2,'0')).join('');
const random = size => crypto.getRandomValues(new Uint8Array(size));
const digest = async value => hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const bits = value => Uint8Array.from(value.match(/../g), x => parseInt(x,16));
const params = new URLSearchParams(location.hash.slice(1));
const isGuest = params.has('room');
let client, state, storeKey, key, last = 0, reading = false, active = false, pending;
function persist(){localStorage.setItem(storeKey,JSON.stringify(state));}
function rpc(action, extra = {}) {
  return request(state?.group ? 'qinti_group' : 'qinti_chat', {action, ...extra});
}
function filePart(extra) { return request('qinti_chat_part', extra); }
async function request(endpoint, extra) {
  let authorization = {};
  if (!isGuest) {
    const session = (await client.auth.getSession()).data.session;
    if (!session || session.user.id !== state.owner) throw Error('请回到青提首页登录。');
    authorization.Authorization = 'Bearer ' + session.access_token;
  }
  const response = await fetch(api+'/rest/v1/rpc/'+endpoint,{
    method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json',...authorization},
    body:JSON.stringify({room:state.room,token:isGuest?state.guest:'',...extra})
  });
  if(!response.ok){
    const error = await response.json().catch(()=>({}));
    if(error.code==='PGRST202') throw Error('聊天服务尚未启用，请联系站点管理员。');
    if(error.message==='Invalid invitation') throw Error('邀请已使用或已过期。');
    if(error.message==='Unauthorized') throw Error('会话已结束或当前浏览器没有访问权限。');
    throw Error('请求失败，请稍后重试。');
  }
  return response.json();
}
function inviteURL(invite){const url=new URL('chat.html',location.href);url.hash=new URLSearchParams({room:state.room,invite,key:state.key,...(state.group?{group:'1'}:{})});return url.href;}
const notificationsKey = () => 'qinti-chat-notify:' + storeKey;
function notificationsOn(){
  return storeKey && window.Notification?.permission === 'granted' && localStorage.getItem(notificationsKey()) === '1';
}
function updateNotifyButton(){
  el('notify').hidden = !active || !window.Notification;
  el('notify').textContent = notificationsOn() ? '关闭桌面通知' : '开启桌面通知';
}
click('notify', async () => {
  if(notificationsOn()) localStorage.removeItem(notificationsKey());
  else {
    const permission = await Notification.requestPermission();
    if(permission !== 'granted'){say('要接收通知，请在浏览器的网站权限中允许通知。');return;}
    localStorage.setItem(notificationsKey(),'1');
  }
  updateNotifyButton();
});
let historyLoaded = false;
function notifyIncoming(){
  if(!notificationsOn())return;
  const viewing = !document.hidden && (hostFrame?.ownerDocument || document).hasFocus() && (!hostFrame || hostFrame.getClientRects().length);
  if(viewing)return;
  try {
    const notice = new Notification(state.group?'青提群聊':'青提私聊', {body:'收到新消息', tag:'qinti-chat-'+state.room});
    notice.onclick = () => {
      (hostFrame?.ownerDocument.defaultView || window).focus();
      hostFrame?.ownerDocument.querySelector('[data-page="chat"]')?.click();
      el('draft').focus();
      notice.close();
    };
  } catch {say('此浏览器暂时无法显示桌面通知。');}
}
async function refresh(){
  if(reading || !active)return;
  reading=true;
  try{
    const {messages,joined,title,members}=await rpc('read',{cursor_seq:last});
    if(!isGuest){el('invite').hidden=!state.group && joined; if(!state.group && joined)el('copyField').hidden=true;}
    if(state.group){
      el('chatTitle').textContent=title;
      el('roomState').textContent='加密群聊 · '+members+' 人';
    }else el('roomState').textContent = joined ? '加密对话 · 对方已加入' : '加密对话 · 等待好友加入';
    if (!last && !messages.length) {
      el('intro').textContent = (state.group ? members>1 : joined) ? '发送第一条消息' : '复制邀请链接发给好友，24 小时内有效。';
    }
    const follow = !last || nearLatest();
    let incoming = false;
    for(const m of messages){
      const item=document.createElement('li');
      try{
        const packed=bits(m.packet);
        const text=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:packed.slice(0,12)},key,packed.slice(12)));
        if(!renderFile(text,item,key,filePart))item.textContent=text;
      }
      catch{item.textContent='此消息无法解密';}
      if(state.group){
        const label=document.createElement('span');
        label.className='sender';
        label.textContent=m.from_host?'群主':'成员 · '+m.sender;
        item.prepend(label);
      }
      if(state.group ? m.mine : m.from_host===!isGuest)item.className='mine';
      else incoming = true;
      el('messages').append(item); last=m.seq;
    }
    if(historyLoaded && incoming)notifyIncoming();
    if(messages.length < 100)historyLoaded=true;
    if(messages.length){
      el('welcome').hidden = true;
      if (follow) scrollToLatest();
      else el('latest').hidden = false;
    }
  }finally{reading=false;}
}
async function openRoom(){
  key=await crypto.subtle.importKey('raw',bits(state.key),'AES-GCM',false,['encrypt','decrypt']);
  if(state.group){el('closeRoom').textContent='解散群聊';el('invite').textContent='邀请群成员';}
  active=true; await refresh();el('nickField').hidden=true; updateNotifyButton(); el('composer').hidden=false;el('join').hidden=true;el('closeRoom').hidden=isGuest;
  el('rename').hidden=isGuest;
  el('rename').textContent=state.group?'修改群名称':'修改私聊备注';
  options.hidden = el('notify').hidden && el('closeRoom').hidden;
  const savedDraft=sessionStorage.getItem(draftSlot());
  if(savedDraft && !draft.value){
    try{
      const bytes=bits(savedDraft);
      const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12));
      if(!draft.value){draft.value=new TextDecoder().decode(clear);sizeDraft();}
    }catch{say('此草稿无法恢复。');}
  }
}
function click(id,callback){el(id).onclick=async()=>{el(id).disabled=true;try{await callback();}catch(e){say(e.message);}finally{el(id).disabled=false;}};}
// Each room has its own key record. Only the selected room ID is shared across reloads.
const roomPrefix = () => storeKey + ':room:';
function hostRooms(){
  return Object.keys(localStorage).filter(k=>k.startsWith(roomPrefix()))
    .map(k=>JSON.parse(localStorage.getItem(k)))
    .filter(r=>r?.owner===state.owner && r.room && r.key)
    .sort((a,b)=>(b.created || 0)-(a.created || 0));
}
function roomLabel(room){return room.group ? '群聊 · '+room.label : room.label || '私聊 · ' + room.room.slice(0,6);}
function rememberSelection(id){
  sessionStorage.setItem(storeKey,id);
  localStorage.setItem(storeKey,JSON.stringify({selectedRoom:id}));
}
const draftSlot=()=>storeKey+':draft:'+state.room;
async function canLeaveRoom(){
  if(el('send').disabled || el('closeRoom').disabled){
    el('directoryStatus').textContent='请等待当前操作完成。';
    return false;
  }
  if(queue.length && !confirm('切换后需要重新选择未发送的附件。继续吗？'))return false;
  if(!state.room || !key)return true;
  try{
    if(draft.value){
      const iv=random(12);
      const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(draft.value));
      sessionStorage.setItem(draftSlot(),hex(iv)+hex(cipher));
    }else sessionStorage.removeItem(draftSlot());
    return true;
  }catch{el('directoryStatus').textContent='无法保存文字草稿，请先复制或发送。';return false;}
}
let cloud=null, refreshing=null, backupBusy=false;
const recoverySlot=()=> 'qinti-chat-recovery:'+state.owner;
async function directoryRequest(args,endpoint='qinti_directory'){
  const {data}=await client.auth.getSession();
  if(data.session?.user.id!==state.owner)throw Error('请重新登录当前账号。');
  const response=await fetch(api+'/rest/v1/rpc/'+endpoint,{
    method:'POST',headers:{apikey:publishableKey,Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},
    body:JSON.stringify(args),signal:AbortSignal.timeout(15000)
  });
  if(!response.ok){
    const error=await response.json().catch(()=>({}));
    if(error.code==='40001')throw Error('名称已在其他设备修改。请取消并重新打开，查看最新名称。');
    throw Error('无法同步会话，请检查网络后重试。');
  }
  return response.json();
}
function cacheName(record,label,version){
  const slot=roomPrefix()+record.room;
  const current=JSON.parse(localStorage.getItem(slot));
  if(!current || version<(current.nameVersion || 0))return;
  if(current.nameVersion!==version || current.label!==label){
    localStorage.setItem(slot,JSON.stringify({...current,label,nameVersion:version}));
  }
  if(state.room===record.room){
    state.label=label;
    state.nameVersion=version;
    el('chatTitle').textContent=state.group?label:roomLabel(state);
  }
}
async function applyCloudName(record,entry){
  const version=entry.name_version;
  if(!record || !Number.isSafeInteger(version) || version<(record.nameVersion || 0))return;
  if(record.group)cacheName(record,entry.title,version);
  else if(version>0 && entry.encrypted_label){
    const label=record.nameVersion===version?record.label:await decryptLabel(record,entry.encrypted_label);
    cacheName(record,label,version);
  }
}
let editVersion=0;
const renameDialog=el('renameDialog');
click('rename',async()=>{
  const entry=await directoryRequest({action:'name',room:state.room});
  await applyCloudName(state,entry);
  editVersion=entry.name_version;
  el('renameTitle').textContent=state.group?'修改群名称':'修改私聊备注';
  el('renameHint').textContent=state.group?'群内所有成员可见':'仅自己的已解锁设备可见，留空可恢复默认名称';
  el('renameInput').required=!!state.group;
  el('renameInput').value=state.label || '';
  el('renameStatus').textContent='';
  renameDialog.showModal();
  el('renameInput').select();
});
el('renameCancel').onclick=()=>renameDialog.close();
renameDialog.oncancel=e=>{if(el('renameSave').disabled)e.preventDefault();};
el('renameForm').onsubmit=async e=>{
  e.preventDefault();
  if(el('renameSave').disabled)return;
  const label=el('renameInput').value.trim();
  if(state.group && !label){el('renameStatus').textContent='请输入群名称。';return;}
  el('renameCancel').disabled=el('renameSave').disabled=true;
  try{
    const value=state.group?label:await encryptLabel(state,key,label);
    const version=await directoryRequest({room:state.room,expected:editVersion,new_name:value},'qinti_rename');
    cacheName(state,label,version);
    renameDialog.close();
    say('名称已保存。');
  }catch(err){el('renameStatus').textContent=err.message;}
  finally{el('renameCancel').disabled=el('renameSave').disabled=false;}
};
let checkingName=false;
async function refreshPrivateName(){
  if(isGuest || !active || state.group || document.hidden || checkingName || (hostFrame && !hostFrame.getClientRects().length))return;
  checkingName=true;
  try{await applyCloudName(state,await directoryRequest({action:'name',room:state.room}));}
  catch{/* The next foreground check retries without interrupting the conversation. */}
  finally{checkingName=false;}
}
window.addEventListener('focus',refreshPrivateName);
document.addEventListener('visibilitychange',refreshPrivateName);
setInterval(refreshPrivateName,30000);
function showBackupControls(unlocked){
  const registered=!!cloud?.verifier;
  el('backupHint').textContent=!cloud?'连接云端后可设置恢复码。':!registered
    ? '启用后，请私下保存恢复码。新设备登录同一账号后，用它恢复聊天密钥。'
    : unlocked?'本机已解锁。新设备登录同一账号后，输入此恢复码即可打开已备份的会话。'
    :'请输入已启用设备上的恢复码。尚未备份的会话需先在原设备打开聊天并完成同步。';
  el('recoveryInput').hidden=!registered || unlocked;
  el('backupAction').hidden=!cloud;
  el('backupAction').textContent=!registered?'启用加密备份':unlocked?'查看恢复码':'解锁并同步';
  el('backupAction').disabled=backupBusy;
}
async function syncDirectory(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    el('refreshDirectory').disabled=true;
    el('cloudStatus').textContent='正在同步会话…';
    const snapshot=await directoryRequest({action:'list'});
    cloud=snapshot;
    const code=localStorage.getItem(recoverySlot());
    const protection=code && await recoveryKey(code);
    const unlocked=!!protection && !!snapshot.verifier && protection.verifier===snapshot.verifier;
    showBackupControls(unlocked);
    const local=new Map(hostRooms().map(r=>[r.room,r]));
    let failed=0;
    for(const entry of snapshot.rooms){
      try{
        let record=local.get(entry.room);
        if(unlocked && !record && entry.envelope){
          record=await restoreRoom(entry,state.owner,protection.key);
          localStorage.setItem(roomPrefix()+entry.room,JSON.stringify(record));
        }
        await applyCloudName(record,entry);
        if(unlocked && record && !entry.envelope){
          const envelope=await sealRoom(record,protection.key);
          await directoryRequest({action:'save',room:entry.room,verifier:protection.verifier,envelope});
          entry.envelope=envelope;
        }
      }catch{failed++;}
    }
    el('cloudStatus').textContent='云端会话 '+snapshot.rooms.length+' 个'+(failed?' · '+failed+' 个会话同步失败，可点刷新重试':'');
    if(!state.room && snapshot.rooms.length){
      el('intro').textContent='打开会话列表，选择要继续的聊天。';
      el('create').textContent='打开会话列表';
    }
  })().catch(()=>{
    el('cloudStatus').textContent='同步失败，显示已缓存的会话。';
  }).finally(()=>{refreshing=null;el('refreshDirectory').disabled=false;renderDirectory();});
  return refreshing;
}
function renderDirectory(){
  const local=new Map(hostRooms().map(record=>[record.room,record]));
  const entries=cloud ? cloud.rooms : [...local.values()];
  const filter=el('roomSearch').value.trim().toLocaleLowerCase();
  const rows=[];
  for(const entry of entries){
    const record=local.get(entry.room);
    const name=record?roomLabel(record):roomLabel({...entry,label:entry.title});
    if(!name.toLocaleLowerCase().includes(filter))continue;
    const button=document.createElement('button');
    button.type='button';
    const heading=document.createElement('strong');
    heading.textContent=name;
    const detail=document.createElement('small');
    detail.textContent=!cloud?'本机缓存':record?(entry.envelope?'云端 · 已备份密钥':'云端 · 本机可打开')
      :entry.envelope?'云端 · 需恢复码':'云端 · 等待原设备备份密钥';
    button.append(heading,detail);
    button.setAttribute('aria-current',String(entry.room===state.room));
    button.onclick=async()=>{
      if(!record){
        el('backupSettings').open=true;
        el('directoryStatus').textContent=entry.envelope?'输入恢复码即可打开此会话。':'请先在有此会话记录的原设备启用加密备份。';
        if(!el('recoveryInput').hidden)el('recoveryInput').focus();
        return;
      }
      if(record.room===state.room){el('directory').close();return;}
      if(!await canLeaveRoom())return;
      rememberSelection(record.room);
      location.reload();
    };
    rows.push(button);
  }
  el('rooms').replaceChildren(...rows);
  if(!rows.length)el('rooms').textContent=filter?'没有匹配的会话':'暂无会话';
}
el('roomSearch').oninput=renderDirectory;
el('refreshDirectory').onclick=syncDirectory;
el('backupAction').onclick=async()=>{
  if(backupBusy)return;
  backupBusy=true;el('backupAction').disabled=true;
  try{
    await syncDirectory();
    if(!el('directory').open)return;
    if(!cloud)throw Error('暂时无法连接云端。');
    const stored=localStorage.getItem(recoverySlot());
    const entering=!el('recoveryInput').hidden;
    const code=entering?el('recoveryInput').value.trim():stored || makeRecoveryCode();
    const {verifier}=await recoveryKey(code);
    if(cloud.verifier && cloud.verifier!==verifier)throw Error('恢复码与本账号不匹配。');
    if(!cloud.verifier){
      // Store before activation, so a lost response cannot lose the only copy.
      localStorage.setItem(recoverySlot(),code);
      await directoryRequest({action:'enable',verifier});
    }
    localStorage.setItem(recoverySlot(),code);
    el('recoveryInput').value='';
    if(!entering && el('directory').open){el('recoveryOutput').value=code;el('recoveryOutput').hidden=false;el('recoveryOutput').select();}
    el('directoryStatus').textContent='';
    await syncDirectory();
  }catch(err){el('directoryStatus').textContent=err.message;}
  finally{backupBusy=false;el('backupAction').disabled=false;}
};
el('directory').addEventListener('close',()=>{
  el('recoveryOutput').hidden=true;el('recoveryOutput').value='';el('recoveryInput').value='';
  el('backupSettings').open=false;
});
function showDirectory(){
  el('directoryStatus').textContent='';
  el('roomSearch').value='';
  el('newRoomDetails').open=!state.room && !(cloud?.rooms.length || hostRooms().length);
  renderDirectory();
  el('directory').showModal();
  syncDirectory();
}
el('chooseRoom').onclick=el('create').onclick=showDirectory;
el('dismissDirectory').onclick=()=>el('directory').close();
el('directory').addEventListener('cancel',e=>{if(el('newRoom').disabled)e.preventDefault();});
let newCandidate;
el('roomType').onchange=()=>{
  newCandidate=null;
  const group=el('roomType').value==='group';
  el('roomName').required=group;
  el('nameLabel').textContent=group?'群名称（成员可见）':'新会话备注（仅自己可见）';
  el('newRoom').textContent=group?'新建群聊':'新建私聊';
};
el('newRoomForm').onsubmit=async e=>{
  e.preventDefault();
  if(el('newRoom').disabled)return;
  el('newRoom').disabled=el('dismissDirectory').disabled=true;
  el('rooms').inert=true;
  el('roomType').disabled=el('roomName').disabled=true;
  try{
    if(!await canLeaveRoom())return;
    newCandidate ||= {owner:state.owner,room:crypto.randomUUID(),key:hex(random(32)),invite:hex(random(32)),created:Date.now()};
    newCandidate.label=el('roomName').value.trim();
    newCandidate.group=el('roomType').value==='group';
    if(newCandidate.group && !newCandidate.label)throw Error('请输入群名称。');
    const endpoint=newCandidate.group?'qinti_group':'qinti_chat';
    // Retrying after an interrupted response can recover the room already created.
    try{await request(endpoint,{action:'create',room:newCandidate.room,payload:newCandidate.group?newCandidate.label:await digest(newCandidate.invite)});}
    catch(err){try{await request(endpoint,{action:'read',room:newCandidate.room});}catch{throw err;}}
    localStorage.setItem(roomPrefix()+newCandidate.room,JSON.stringify(newCandidate));
    rememberSelection(newCandidate.room);
    location.reload();
  }catch(err){el('directoryStatus').textContent=err.message;}
  finally{el('newRoom').disabled=el('dismissDirectory').disabled=false;el('rooms').inert=false;el('roomType').disabled=el('roomName').disabled=false;}
};
window.addEventListener('storage',e=>{
  if(isGuest || !storeKey || !e.key?.startsWith(roomPrefix()))return;
  if(e.key===roomPrefix()+state.room && e.newValue===null){location.reload();return;}
  if(el('directory').open)renderDirectory();
});
click('invite',async()=>{
  el('copyField').hidden=true;
  let invite=state.invite;
  if(state.group){
    invite=hex(random(32));
    await rpc('invite',{payload:await digest(invite)});
  }
  const url=inviteURL(invite);
  try{await navigator.clipboard.writeText(url);say(state.group?'已复制一人份邀请链接，邀请下一位请再点一次。':'邀请链接已复制，请私下发给对方。');}
  catch{el('copyField').hidden=false;el('copyField').value=url;el('copyField').select();}
});
click('join',async()=>{
  // Keep the same claim secret if the response is lost after the server commits.
  const nickname=el('nickname').value.trim();
  if(state.group && !nickname){say('请输入群内昵称。');el('nickname').focus();return;}
  if(!state.guest){state.guest=hex(random(32));persist();}
  try{await rpc('join',{token:params.get('invite'),payload:await digest(state.guest),...(state.group?{nickname}:{})});}
  catch(e){try{await rpc('read');}catch{throw e;}}
  state.accepted=true;persist();history.replaceState(null,'','#room='+state.room);await openRoom();
});
click('closeRoom',async()=>{
  if(!confirm(state.group?'解散群聊并删除所有群消息和附件？':'结束私聊并删除这段对话的所有消息？'))return;
  await rpc('close');active=false;sessionStorage.removeItem(draftSlot());
  localStorage.removeItem(roomPrefix()+state.room);
  sessionStorage.removeItem(storeKey);
  const saved=JSON.parse(localStorage.getItem(storeKey));
  if(saved?.selectedRoom===state.room){
    const next=hostRooms()[0];
    if(next)rememberSelection(next.room);
    else localStorage.removeItem(storeKey);
  }
  location.reload();
});
const queue = [];
const draft = el('draft');
function sizeDraft(){
  draft.style.height = 'auto';
  draft.style.height = draft.scrollHeight + 'px';
}
draft.addEventListener('input', sizeDraft);
function showQueue(){
  el('queued').replaceChildren(...queue.map(entry => {
    const remove = document.createElement('button');
    remove.type = 'button';
    if(entry.thumb){
      const img = document.createElement('img');
      img.src = entry.thumb;
      img.alt = '';
      remove.append(img);
    }
    remove.append(entry.file.name + ' ×');
    remove.setAttribute('aria-label', '移除 ' + entry.file.name);
    remove.disabled = el('send').disabled;
    remove.onclick = () => { queue.splice(queue.indexOf(entry),1); if(entry.thumb)URL.revokeObjectURL(entry.thumb); showQueue(); };
    return remove;
  }));
}
function addFiles(files){
  if(el('send').disabled)return;
  for(const file of files){
    if(!file.size || file.size > MAX_FILE_SIZE){say('文件为空或超过 16 MB：'+file.name);continue;}
    if(queue.length >= 8){say('每次最多选择 8 个附件。');break;}
    const thumb = /^image\/(png|jpeg|webp|gif|avif)$/.test(file.type) ? URL.createObjectURL(file) : null;
    queue.push({file, thumb, id:crypto.randomUUID()});
  }
  showQueue();
}
el('attach').onclick = () => el('files').click();
el('files').onchange = e => {addFiles(e.target.files);e.target.value='';draft.focus();};
draft.addEventListener('paste', e => {
  const files = Array.from(e.clipboardData?.files || []);
  if(files.length){e.preventDefault();addFiles(files);}
});
draft.addEventListener('keydown', e => {
  if(e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229)return;
  e.preventDefault();
  if(!e.repeat && !el('send').disabled)el('composer').requestSubmit();
});
async function sendPacket(text,id){
  const iv=random(12);
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text));
  await rpc('send',{payload:hex(iv)+hex(cipher),message_id:id});
}
el('composer').onsubmit=async e=>{
  e.preventDefault();
  const text=draft.value.trim();
  if(el('send').disabled || (!text && !queue.length))return;
  el('send').disabled=true;el('attach').disabled=true;draft.readOnly=true;showQueue();
  try{
    while(queue.length){
      const entry=queue[0];
      if(!entry.upload)entry.upload=await prepareFile(entry.file,key);
      await uploadFile(entry.upload,filePart,(part,total)=>say('正在发送 '+entry.file.name+' · '+part+'/'+total));
      await sendPacket(entry.upload.manifest,entry.id);
      queue.shift();if(entry.thumb)URL.revokeObjectURL(entry.thumb);showQueue();
    }
    if(text){
      if(pending?.text!==text)pending={text,id:crypto.randomUUID()};
      await sendPacket(text,pending.id);
      pending=null;draft.value='';sessionStorage.removeItem(draftSlot());
    }
    say('');sizeDraft();
    await refresh();scrollToLatest();
  }catch(err){say('发送失败：'+err.message+' 可再次点发送。');}
  finally{draft.readOnly=false;el('send').disabled=false;el('attach').disabled=false;showQueue();draft.focus();}
};
async function start(){
  if(isGuest){
    const room=params.get('room');
    if(!/^[0-9a-f-]{36}$/.test(room))throw Error('邀请地址不完整。');
    storeKey='qinti-chat-guest:'+room;
    state=JSON.parse(localStorage.getItem(storeKey));
    if(state?.accepted){await openRoom();return;}
    if(![params.get('invite'),params.get('key')].every(v=>/^[0-9a-f]{64}$/.test(v||'')))throw Error('请打开完整的邀请链接。');
    state={room,key:params.get('key'),guest:state?.guest,group:params.get('group')==='1'};
    if(state.group){
      el('nickField').hidden=false;
      el('chatTitle').textContent='青提群聊';
      el('join').textContent='加入群聊';
    }
    say(state.group?'填写昵称加入群聊，可查看群内已有消息。':'首次接受后，仅此浏览器可继续这段对话。');el('join').hidden=false;
  }else{
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm');
    client=createClient(api,publishableKey);
    const user=(await client.auth.getSession()).data.session?.user;
    if(!user)throw Error('请从青提首页登录后创建邀请。收到邀请可直接打开链接。');
    storeKey='qinti-chat-host:'+user.id;
    state={owner:user.id};
    const saved=JSON.parse(localStorage.getItem(storeKey));
    if(saved?.room && saved.owner===user.id && saved.key){
      localStorage.setItem(roomPrefix()+saved.room,JSON.stringify(saved));
      rememberSelection(saved.room);
    }
    const rooms=hostRooms();
    const selected=rooms.find(r=>r.room===sessionStorage.getItem(storeKey))
      || rooms.find(r=>r.room===saved?.selectedRoom) || rooms[0];
    el('chooseRoom').hidden=false;
    syncDirectory();
    if(selected){
      state=selected;
      sessionStorage.setItem(storeKey,state.room);
      el('chatTitle').textContent=roomLabel(state);
      await openRoom();
    }
    else{say('创建会话，邀请好友加入。');el('create').hidden=false;}
  }
}
// Only the signed-in homepage embeds the host view. Invitations open independently.
const hostFrame = window.parent === window || isGuest || new URL(document.referrer || location.href).origin !== location.origin
  ? null : window.frameElement;
if(hostFrame){
  document.documentElement.classList.add('embedded');
  const parentRoot = hostFrame.ownerDocument.documentElement;
  const syncTheme = () => { document.documentElement.dataset.theme = parentRoot.dataset.theme || 'light'; };
  syncTheme();
  const observer = new MutationObserver(syncTheme);
  observer.observe(parentRoot,{attributes:true,attributeFilter:['data-theme']});
  window.addEventListener('pagehide', event => { if(!event.persisted)observer.disconnect(); });
}
start().catch(e=>say(e.message));
setInterval(()=>{if(notificationsOn() || (!document.hidden && (!hostFrame || hostFrame.getClientRects().length)))refresh().catch(e=>say(e.message));},3000);
