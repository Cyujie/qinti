const encoder = new TextEncoder();
function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
function decode(text) {
  return Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
}
export function makeRecoveryCode() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
export async function recoveryKey(code) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw Error('恢复码格式有误，请完整粘贴。');
  const raw = decode(code);
  if (raw.length !== 32 || encode(raw)!==code) throw Error('恢复码格式有误。');
  const key = await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',raw));
  const verifier = Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
  return {key,verifier};
}
function algorithm(owner,room,iv) {
  return {name:'AES-GCM',iv,additionalData:encoder.encode('qinti-directory-v1/'+owner+'/'+room)};
}
export async function sealRoom(record, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify({key:record.key,invite:record.invite,label:record.label || ''}));
  const ciphertext = await crypto.subtle.encrypt(algorithm(record.owner,record.room,iv),key,data);
  return encode(iv)+'.'+encode(new Uint8Array(ciphertext));
}
export async function restoreRoom(entry,owner,envelopeKey) {
  const [iv,payload] = entry.envelope.split('.');
  const data = await crypto.subtle.decrypt(algorithm(owner,entry.room,decode(iv)),envelopeKey,decode(payload));
  const saved = JSON.parse(new TextDecoder().decode(data));
  if(!/^[a-f0-9]{64}$/.test(saved.key) || !/^[a-f0-9]{64}$/.test(saved.invite) || typeof saved.label!=='string')throw Error('密钥备份格式有误。');
  return {owner,room:entry.room,created:Date.parse(entry.created),group:entry.group,label:saved.label,key:saved.key,invite:saved.invite};
}

function labelAlgorithm(record,iv){
  return {name:'AES-GCM',iv,additionalData:encoder.encode('qinti-label-v1/'+record.owner+'/'+record.room)};
}
export async function encryptLabel(record,key,label){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt(labelAlgorithm(record,iv),key,encoder.encode(label));
  return encode(iv)+'.'+encode(new Uint8Array(bytes));
}
export async function decryptLabel(record,envelope){
  const [iv,data]=envelope.split('.');
  const raw=Uint8Array.from(record.key.match(/../g),byte=>parseInt(byte,16));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
  const bytes=await crypto.subtle.decrypt(labelAlgorithm(record,decode(iv)),key,decode(data));
  return new TextDecoder().decode(bytes);
}
