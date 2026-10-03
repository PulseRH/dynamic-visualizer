const assert = require('node:assert/strict');
const {describeProcesses} = require('../electron/process-usage.cjs');
const metric = (pid, type, extra = {}) => ({pid, type, cpu:{percentCPUUsage:1.25}, memory:{workingSetSize:2048}, ...extra});
const rows = describeProcesses([
  metric(1,'Browser'), metric(2,'Tab'), metric(3,'GPU'),
  metric(4,'Utility',{name:'Audio Service',serviceName:'audio.mojom.AudioService'}),
  metric(5,'Utility',{serviceName:'Network Service'}),
  metric(6,'Tab',{cpu:{percentCPUUsage:NaN},memory:{}}),
], [{pid:2,name:'Settings / audio / preview'}, {pid:2,name:'Wallpaper 1'}, {pid:2,name:'Wallpaper 1'}]);
assert.deepEqual(rows.map(row=>row.name), ['Main / tray','Settings / audio / preview + Wallpaper 1','GPU rendering','Audio Service','Network Service','Renderer']);
assert.deepEqual(rows.map(row=>row.pid),[1,2,3,4,5,6]);
assert.equal(rows[0].ramMB,2);
assert.equal(rows[0].cpu,1.25);
assert.equal(rows[5].cpu,null); assert.equal(rows[5].ramMB,null);
assert.deepEqual(describeProcesses([]),[]);
console.log('PASS: native PIDs, shared renderers, utility names, working-set units and missing metrics.');
