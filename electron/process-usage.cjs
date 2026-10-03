'use strict';

// Windows helper names come from the shared executable. Preserve native PIDs
// and combine window roles when Chromium shares a renderer between windows.
function describeProcesses(metrics, windowRoles = []) {
  const roles = new Map();
  for (const {pid, name} of windowRoles) {
    if (!roles.has(pid)) roles.set(pid, []);
    if (!roles.get(pid).includes(name)) roles.get(pid).push(name);
  }
  return metrics.map(metric => ({
    pid: metric.pid,
    name: roles.get(metric.pid)?.join(' + ') || ({
      Browser: 'Main / tray', GPU: 'GPU rendering',
      Tab: 'Renderer', Renderer: 'Renderer',
    })[metric.type] || metric.name || metric.serviceName || metric.type || 'Helper',
    cpu: Number.isFinite(metric.cpu?.percentCPUUsage) ? metric.cpu.percentCPUUsage : null,
    ramMB: Number.isFinite(metric.memory?.workingSetSize) ? metric.memory.workingSetSize / 1024 : null,
  }));
}
module.exports = { describeProcesses };
