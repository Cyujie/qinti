const api = 'https://uomgorcvmqodmfnxovri.supabase.co';
const publishableKey = 'sb_publishable_udvGflXSwMiribxIMmNlew_dZUD3Ng1';
const el = id => document.getElementById(id);
const say = value => { el('status').textContent = value; };
const hex = data => Array.from(new Uint8Array(data), b => b.toString(16).padStart(2,'0')).join('');
const random = size => crypto.getRandomValues(new Uint8Array(size));
const digest = async value => hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const bits = value => Uint8Array.from(value.match(/../g), x => parseInt(x,16));
const params = new URLSearchParams(location.hash.slice(1));
const isGuest = params.has('room');
let client, state, storeKey, key, last = 0, reading = false, active = false, pending;
function persist(){localStorage.setItem(storeKey,JSON.stringify(state));}
async function rpc(action, extra = {}) {
  let authorization = {};
  if (!isGuest) {
    const session = (await client.auth.getSession()).data.session;
    if (!session || session.user.id !== state.owner) throw Error('请回到青提首页登录。');
    authorization.Authorization = 'Bearer ' + session.access_token;
  }
  const response = await fetch(api+'/rest/v1/rpc/qinti_chat',{
    method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json',...authorization},
    body:JSON.stringify({action,room:state.room,token:isGuest?state.guest:'',...extra})
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
function inviteURL(){const url=new URL('chat.html',location.href);url.hash=new URLSearchParams({room:state.room,invite:state.invite,key:state.key});return url.href;}
async function refresh(){
  if(reading || !active)return;
  reading=true;
  try{
    const {messages,joined}=await rpc('read',{cursor_seq:last});
    if(!isGuest){el('invite').hidden=joined; if(joined)el('copyField').hidden=true;}
    if(last===0 && !messages.length)say(joined?'双方已连接。':'邀请有效期为 24 小时，首位接受者可加入。');
    for(const m of messages){
      const item=document.createElement('li');
      const packed=bits(m.packet);
      try{item.textContent=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:packed.slice(0,12)},key,packed.slice(12)));}
      catch{item.textContent='此消息无法解密';}
      if(m.from_host===!isGuest)item.className='mine';
      el('messages').append(item); last=m.seq;
    }
    if(messages.length){el('messages').scrollTop=el('messages').scrollHeight;say('私聊中');}
  }finally{reading=false;}
}
async function openRoom(){
  key=await crypto.subtle.importKey('raw',bits(state.key),'AES-GCM',false,['encrypt','decrypt']);
  active=true; await refresh(); el('composer').hidden=false;el('join').hidden=true;el('closeRoom').hidden=isGuest;
}
function click(id,callback){el(id).onclick=async()=>{el(id).disabled=true;try{await callback();}catch(e){say(e.message);}finally{el(id).disabled=false;}};}
click('create',async()=>{
  state={owner:state.owner,room:crypto.randomUUID(),key:hex(random(32)),invite:hex(random(32))};
  await rpc('create',{payload:await digest(state.invite)});persist();el('create').hidden=true;await openRoom();
});
click('invite',async()=>{
  const url=inviteURL();
  try{await navigator.clipboard.writeText(url);say('邀请链接已复制，请私下发给对方。');}
  catch{el('copyField').hidden=false;el('copyField').value=url;el('copyField').select();}
});
click('join',async()=>{
  // Keep the same claim secret if the response is lost after the server commits.
  if(!state.guest){state.guest=hex(random(32));persist();}
  try{await rpc('join',{token:params.get('invite'),payload:await digest(state.guest)});}
  catch(e){try{await rpc('read');}catch{throw e;}}
  state.accepted=true;persist();history.replaceState(null,'','#room='+state.room);await openRoom();
});
click('closeRoom',async()=>{
  if(!confirm('结束私聊并删除这段对话的所有消息？'))return;
  await rpc('close');active=false;localStorage.removeItem(storeKey);location.reload();
});
el('composer').onsubmit=async e=>{
  e.preventDefault();if(el('send').disabled)return;
  const draft=el('draft'), text=draft.value.trim();if(!text)return;
  el('send').disabled=true;draft.readOnly=true;
  try{
    if(pending?.text!==text){
      const iv=random(12), cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text));
      pending={text,id:crypto.randomUUID(),packet:hex(iv)+hex(cipher)};
    }
    await rpc('send',{payload:pending.packet,message_id:pending.id});
    pending=null;draft.value='';await refresh();
  }catch(err){say(err.message);}finally{draft.readOnly=false;el('send').disabled=false;}
};
async function start(){
  if(isGuest){
    const room=params.get('room');
    if(!/^[0-9a-f-]{36}$/.test(room))throw Error('邀请地址不完整。');
    storeKey='qinti-chat-guest:'+room;
    state=JSON.parse(localStorage.getItem(storeKey));
    if(state?.accepted){await openRoom();return;}
    if(![params.get('invite'),params.get('key')].every(v=>/^[0-9a-f]{64}$/.test(v||'')))throw Error('请打开完整的邀请链接。');
    state={room,key:params.get('key'),guest:state?.guest};
    say('首次接受后，仅此浏览器可继续这段对话。');el('join').hidden=false;
  }else{
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm');
    client=createClient(api,publishableKey);
    const user=(await client.auth.getSession()).data.session?.user;
    if(!user)throw Error('请从青提首页登录后创建邀请。收到邀请可直接打开链接。');
    storeKey='qinti-chat-host:'+user.id;
    state=JSON.parse(localStorage.getItem(storeKey))||{owner:user.id};
    if(state.room)await openRoom();
    else{say('创建一段私聊，邀请一位朋友加入。');el('create').hidden=false;}
  }
}
// Only the signed-in homepage embeds the host view. Invitations open independently.
const hostFrame = window.parent === window || isGuest || new URL(document.referrer || location.href).origin !== location.origin
  ? null : window.frameElement;
if(hostFrame){
  document.documentElement.classList.add('embedded');
  const content=document.querySelector('main');
  new ResizeObserver(()=>{
    if(content.offsetHeight)hostFrame.style.height=content.offsetHeight+'px';
  }).observe(content);
}
start().catch(e=>say(e.message));
setInterval(()=>{if(!document.hidden && (!hostFrame || hostFrame.getClientRects().length))refresh().catch(e=>say(e.message));},3000);
