const PART_SIZE = 256 * 1024;
export const MAX_FILE_SIZE = 16 * 1024 * 1024;
const marker = '\0qinti-file-v1:';
const images = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
const videos = new Set(['video/mp4','video/webm','video/quicktime','video/ogg']);

function base64(bytes) {
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(raw);
}
function decode(value) {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
export async function prepareFile(file, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, await file.arrayBuffer()));
  const info = {id:crypto.randomUUID(), name:file.name.slice(0,200), type:file.type.slice(0,100), size:file.size, iv:base64(iv)};
  return {cipher, info, next:0, manifest:marker + JSON.stringify(info)};
}
export async function uploadFile(upload, request, progress) {
  const count = Math.ceil(upload.cipher.length / PART_SIZE);
  while (upload.next < count) {
    const i = upload.next;
    const bytes = upload.cipher.subarray(i * PART_SIZE, (i + 1) * PART_SIZE);
    progress(i + 1, count);
    await request({file_id:upload.info.id, part:i, content:base64(bytes)});
    upload.next++;
  }
}
export function renderFile(text, item, key, request) {
  if (!text.startsWith(marker)) return false;
  const info = JSON.parse(text.slice(marker.length));
  if (!Number.isSafeInteger(info.size) || info.size < 1 || info.size > MAX_FILE_SIZE ||
      typeof info.name !== 'string' || typeof info.type !== 'string' || decode(info.iv).length !== 12 ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(info.id)) throw Error('Invalid attachment');
  const preview = images.has(info.type) ? 'img' : videos.has(info.type) ? 'video' : null;
  const button = document.createElement('button');
  const label = (preview ? '查看' : '下载') + ' ' + info.name + '（' + Math.ceil(info.size/1024) + ' KB）';
  button.textContent = label;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const bytes = new Uint8Array(info.size + 16);
      for (let offset = 0; offset < bytes.length; offset += PART_SIZE) {
        const part = offset / PART_SIZE;
        button.textContent = '正在加载 ' + Math.round(offset / bytes.length * 100) + '%';
        const chunk = decode(await request({file_id:info.id, part}));
        if (chunk.length !== Math.min(PART_SIZE, bytes.length-offset)) throw Error();
        bytes.set(chunk, offset);
      }
      const clear = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(info.iv)}, key, bytes);
      const url = URL.createObjectURL(new Blob([clear], {type:preview ? info.type : 'application/octet-stream'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = info.name;
      link.textContent = '保存 ' + info.name;
      button.replaceWith(link);
      if (preview) {
        const media = document.createElement(preview);
        if (preview === 'video') { media.controls = true; media.playsInline = true; }
        else media.alt = info.name;
        media.src = url;
        item.prepend(media);
      } else link.click();
    } catch {
      button.disabled = false;
      button.textContent = '加载失败，重试 · ' + info.name;
    }
  };
  item.append(button);
  return true;
}
