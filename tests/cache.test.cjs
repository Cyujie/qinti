const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {prepareImport} = require('../harvest-rules.js');

test('缓存空间耗尽时仍显示云端结果，换账号后隔离', () => {
  let reads=0;
  let onStorage;
  const context=vm.createContext({currentUser:{id:'a'},window:{addEventListener(type,fn){onStorage=fn;}},
    renderRecords(){},renderAchievements(){},calc(){},localStorage:{
    getItem(key){reads++;return JSON.stringify([{owner:key.split(':').pop()}]);},
    setItem(){throw Error('quota');}
  }});
  vm.runInContext(readFileSync(require.resolve('../harvest-cloud.js'),'utf8'),context);
  assert.equal(context.loadRecords()[0].owner,'a');
  assert.equal(context.loadRecords()[0].owner,'a');
  assert.equal(reads,1);
  context.saveRecords([{amount:90}]);
  assert.equal(context.loadRecords()[0].amount,90);
  context.currentUser={id:'b'};
  assert.equal(context.loadRecords()[0].owner,'b');
  assert.equal(reads,2);
  onStorage({key:'meal-allowance-records-v1:b'});
  context.loadRecords();
  assert.equal(reads,3);
});

test('旧零串可导入，逐条拒绝非整串或越界的数量', () => {
  const row={date:'2026-11-18',amount:30};
  for(const amount of [0,30,90])assert.equal(prepareImport({records:[{...row,amount}]})[0].amount,amount);
  for(const amount of [1,29,31,30.5,2147483648])
    assert.throws(()=>prepareImport({records:[row,{...row,amount}]}),/第 2 条记录/);
});
