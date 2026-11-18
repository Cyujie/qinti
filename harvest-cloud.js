'use strict';

let recordsVersion = 0;
let checkinVersion = 0;
let checkinOwner = null;
let checkinDays = new Set();
let checkinBusy = false;
let checkinNotice = '';
let harvestBusy = false;
let importing = false;
let lastClockDay = '';

async function readAccountRows(table, fields, owner, sort) {
  const rows = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    let query = supabaseClient.from(table).select(fields).eq('user_id', owner).order(sort, {ascending:false});
    if (sort !== 'date') query = query.order('id');
    const {data,error} = await query.range(offset, offset + size - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < size || currentUser?.id !== owner) return rows;
  }
}

async function loadRemoteRecords() {
  const owner = currentUser?.id;
  if (!owner) return;
  const version = ++recordsVersion;
  const data = await readAccountRows('harvest_records','id,date,kind_name,detail,amount,created',owner,'created');
  if (owner !== currentUser?.id || version !== recordsVersion) return;
  saveRecords(data.map(r => ({id:r.id, date:r.date, kindName:r.kind_name, detail:r.detail, amount:r.amount, created:r.created})));
  renderRecords();
  renderAchievements();
  calc();
}

async function saveHarvestRows(owner, rows) {
  const {data,error} = await supabaseClient.rpc('qinti_save_harvest',{p_user:owner,p_rows:rows});
  if (error) throw error;
  return data;
}

async function submitHarvest() {
  if (harvestBusy || !currentUser) return;
  if (!datetimeTouched) updateClock();
  const result = calc();
  const date = dateInput.value;
  if (loadRecords().some(r => r.date === date && r.amount > 0)) {
    document.querySelector('[data-page="receive"]').click();
    return;
  }
  if (!result.bunches) return;
  const owner = currentUser.id;
  harvestBusy = true;
  calc();
  let committed = false;
  try {
    const detail = result.kind === 'weekend' ? result.hours + '采摘' : '采摘结束时间 ' + $('end').value;
    const added = await saveHarvestRows(owner,[{date,kindName:result.badge,amount:result.bunches*30,detail}]);
    committed = true;
    if (owner !== currentUser?.id) return;
    $('harvestStatus').textContent = added ? '已保存 ' + result.bunches + ' 串' : '该日期已提交采摘';
    await loadRemoteRecords();
  } catch (error) {
    if (currentUser?.id === owner) $('harvestStatus').textContent =
      (committed ? '云端已处理，刷新记录失败：' : '保存失败：') + error.message;
  } finally {
    harvestBusy = false;
    calc();
  }
}

async function importHarvest(file) {
  const owner = currentUser?.id;
  if (!file || !owner || importing) return;
  importing = true;
  $('readJson').disabled = true;
  let saved = '';
  try {
    const records = HarvestRules.prepareImport(JSON.parse(await file.text()));
    if (owner !== currentUser?.id) return;
    const inserted = await saveHarvestRows(owner, records);
    saved = '已新增 ' + inserted + ' 条，跳过 ' + (records.length-inserted) + ' 条（零串或同日记录）';
    if (owner !== currentUser?.id) return;
    await loadRemoteRecords();
    if (owner === currentUser?.id) $('syncStatus').textContent = saved;
  } catch (error) {
    if (owner === currentUser?.id) $('syncStatus').textContent =
      (saved ? saved + '。刷新失败：' : '导入未完成，可安全重试：') + error.message;
  } finally {
    importing = false;
    $('readJson').disabled = false;
    $('importJson').value = '';
  }
}

function legacyCheckins() {
  const dates = new Set();
  try {
    const history = JSON.parse(localStorage.getItem('qinti-checkins') || '[]');
    if (Array.isArray(history)) history.forEach(day => dates.add(day));
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('qinti-checkin-')) dates.add(key.slice('qinti-checkin-'.length));
    }
  } catch {}
  const today = beijingDate();
  return [...dates].filter(day => HarvestRules.validDate(day) && day <= today);
}

function renderCheckin() {
  const done = checkinDays.has(beijingDate());
  $('checkinBtn').disabled = !currentUser || done || checkinBusy;
  $('checkinBtn').textContent = checkinBusy ? '处理中…' : done ? '已签到' : '签到';
  $('claimDays').hidden = !currentUser || !legacyCheckins().length;
  $('claimDays').disabled = checkinBusy;
  $('checkinStatus').textContent = checkinNotice;
}

async function loadCheckins() {
  const owner = currentUser?.id;
  if (!owner) return;
  const version = ++checkinVersion;
  try {
    const rows = await readAccountRows('harvest_checkins','date',owner,'date');
    if (owner !== currentUser?.id || version !== checkinVersion) return;
    checkinDays = new Set(rows.map(r => r.date));
    renderCheckin();
    renderRecords();
  } catch (e) {
    if (owner === currentUser?.id && version === checkinVersion) {
      checkinNotice = '签到记录加载失败：' + e.message;
      renderCheckin();
    }
  }
}

function updateCloudAccount() {
  const owner = currentUser?.id || null;
  if (checkinOwner === owner) return;
  checkinOwner = owner;
  recordsVersion++;
  checkinVersion++;
  checkinDays = new Set();
  checkinBusy = false;
  checkinNotice = '';
  memoryRecords = [];
  visibleRecordCount = 5;
  selectedIds.clear();
  selectionMode = false;
  $('deleteSelected').hidden = true;
  $('selectMode').textContent = '选择删除';
  $('harvestStatus').textContent = '';
  $('syncStatus').textContent = '';
  renderCheckin();
  renderRecords();
  renderAchievements();
  calc();
  if (owner) {
    loadRemoteRecords().catch(e => {
      if (owner === currentUser?.id) $('syncStatus').textContent = '收获记录加载失败：' + e.message;
    });
    loadCheckins();
  }
}

async function markCheckin(claim = false) {
  const owner = currentUser?.id;
  if (!owner || checkinBusy) return;
  const legacy = claim ? legacyCheckins() : [];
  if (claim && (!legacy.length || !confirm('把本浏览器的 ' + legacy.length + ' 个旧签到日期归入 ' + currentUser.email + '？'))) return;
  checkinBusy = true;
  checkinNotice = '';
  renderCheckin();
  try {
    const rows = claim ? legacy.map(date => ({user_id:owner,date})) : [{user_id:owner}];
    const {error} = await supabaseClient.from('harvest_checkins').upsert(rows,{onConflict:'user_id,date',ignoreDuplicates:true});
    if (error) throw error;
    if (owner !== currentUser?.id) return;
    if (claim) {
      localStorage.removeItem('qinti-checkins');
      legacy.forEach(day => localStorage.removeItem('qinti-checkin-' + day));
    }
    checkinNotice = claim ? '旧签到已归入当前账号' : '签到成功';
    await loadCheckins();
  } catch (error) {
    if (owner === currentUser?.id) checkinNotice = '签到保存失败：' + error.message;
  } finally {
    if (owner === currentUser?.id) {
      checkinBusy = false;
      renderCheckin();
    }
  }
}
