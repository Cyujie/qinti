const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

test('通知保留所属会话，账号切换后旧通知失效',()=>{
  const notices=[];
  const badge={setAttribute(){}};
  const frame={dataset:{owner:'a'},isConnected:true,
    addEventListener(type,handler){this.receive=handler;},
    dispatchEvent(){this.opened=this.dataset.targetRoom;}};
  const ctx=vm.createContext({
    frame, chatPanel:{firstElementChild:frame}, currentUser:{id:'a'},
    document:{getElementById:()=>badge},window:{focus(){}},selectSection(){},Event,
    Notification:class {constructor(){notices.push(this);}close(){}}
  });
  vm.runInContext(readFileSync(require.resolve('../inbox-host.js'),'utf8')+'\nattachInbox(frame);',ctx);
  const poll=(counts,viewing=null)=>frame.receive({detail:{
    rows:counts.map(([room,unread,incoming_seq])=>({room,unread,incoming_seq})),viewing,notify:true
  }});
  poll([['old',3,10]]);
  assert.equal(badge.textContent,'3');
  assert.equal(notices.length,0);
  poll([['old',4,11],['new',1,12]],'old');
  poll([['old',4,11],['new',1,12]]);
  assert.equal(notices.length,1);
  notices[0].onclick();
  assert.equal(frame.opened,'new');
  poll([['old',0,0],['new',0,0]]);
  assert.equal(badge.hidden,true);
  ctx.currentUser={id:'b'};
  frame.opened=null;
  notices[0].onclick();
  assert.equal(frame.opened,null);
});
