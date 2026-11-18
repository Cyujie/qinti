const {test} = require('node:test');
const assert = require('node:assert/strict');
const {estimate, prepareImport} = require('../harvest-rules.js');

test('北京时间跨时段和跨日重新计算', () => {
  for (const [date,time,expected] of [
    ['2026-11-18','20:29',0], ['2026-11-18','20:30',1],
    ['2026-11-18','22:59',1], ['2026-11-18','23:00',1], ['2026-11-18','23:30',2],
    ['2026-11-19','00:00',3], ['2026-11-19','06:59',15], ['2026-11-19','07:00',0],
    ['2026-11-21','00:00',0], ['2026-11-21','07:00',2], ['2026-11-21','23:00',0],
  ]) assert.equal(estimate(date,time,7).bunches,expected, date+' '+time);
});

test('周末档位和无效时长', () => {
  for (const [hours,bunches] of [[2.9,0],[3,1],[6.9,1],[7,2],[25,0]]) {
    assert.equal(estimate('2026-11-21','12:00',hours).bunches,bunches);
  }
});

test('旧导出时间按北京时间转换，逐条标明错误', () => {
  const record = {date:'2026-10-08',amount:30,created:'2026/10/15 3:29:18'};
  assert.equal(prepareImport({records:[record]})[0].created,'2026-10-14T19:29:18.000Z');
  for (const invalid of [{date:'2026-02-31'}, {amount:-1}, {amount:null}, {created:'invalid'}]) {
    assert.throws(()=>prepareImport({records:[record,{...record,...invalid}]}), /第 2 条记录/);
  }
});
