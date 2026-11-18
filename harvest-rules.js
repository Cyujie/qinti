'use strict';

const HarvestRules = (() => {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  function validDate(value) {
    if (typeof value !== 'string' || !datePattern.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function estimate(date, time, duration) {
    if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return {kind:'weekday', badge:'采摘时间', bunches:0, cap:0, hours:'—', detail:'请选择有效的北京时间'};
    }
    const weekday = new Date(date + 'T12:00:00+08:00').getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const night = time >= '23:00' || time < '07:00';
    if (night) {
      const [hour, minute] = time.split(':').map(Number);
      const elapsed = Math.min((hour * 60 + minute + 60) % 1440, 420);
      return {kind:'night', badge:'凌晨采摘', bunches:weekend ? 0 : 1 + Math.floor(elapsed / 30),
        cap:weekend ? 0 : 15, hours:weekend ? '—' : Math.round(elapsed / 6) / 10 + ' 小时',
        detail:weekend ? '周末凌晨不计入收获' : '基础 1 串，每满半小时增加 1 串，上限 15 串'};
    }
    if (weekend) {
      const hours = Number(duration);
      const valid = Number.isFinite(hours) && hours >= 0 && hours <= 24;
      const bunches = valid ? Number(hours >= 3) + Number(hours >= 7) : 0;
      return {kind:'weekend', badge:'周末采摘', bunches, cap:2, hours:valid ? hours + ' 小时' : '—',
        detail:valid ? '满 3 小时收获 1 串，满 7 小时收获 2 串' : '请输入 0 至 24 小时的采摘时长'};
    }
    const bunches = Number(time >= '20:30');
    return {kind:'weekday', badge:'工作日采摘', bunches, cap:1, hours:'—',
      detail:bunches ? '已达到晚间采摘时间' : '工作日从 20:30 开始采摘'};
  }

  function prepareImport(data) {
    if (!Array.isArray(data?.records)) throw Error('文件缺少 records 数组');
    return data.records.map((r, index) => {
      const fail = message => { throw Error('第 ' + (index + 1) + ' 条记录' + message); };
      if (!validDate(r?.date)) fail('日期无效');
      if (typeof r.amount !== 'number' || !Number.isInteger(r.amount) || r.amount < 0 || r.amount > 2147483647) fail('数量无效');
      if (r.amount % 30 !== 0) fail('数量单位无效，1 串应填写 30');
      let created = r.created;
      if (created != null) {
        if (typeof created !== 'string') fail('创建时间无效');
        const old = /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(created);
        if (old) {
          const [, y,m,d,h,min,s] = old;
          created = y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0')+'T'+h.padStart(2,'0')+':'+min+':'+s+'+08:00';
        }
        if (!Number.isFinite(Date.parse(created))) fail('创建时间无效');
        created = new Date(created).toISOString();
      }
      return {date:r.date, amount:r.amount, kindName:String(r.kindName ?? ''), detail:String(r.detail ?? ''), created};
    });
  }
  return {validDate, estimate, prepareImport};
})();
if (typeof module !== 'undefined') module.exports = HarvestRules;
