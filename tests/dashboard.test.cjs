const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const source = readFileSync(join(root, 'dashboard.js'), 'utf8');

function loadDashboard() {
  let now = 0;
  const timers = [];
  const toggles = [...html.matchAll(/<input\b[^>]*data-device-toggle[^>]*>/g)].map(([markup]) => {
    const classes = new Set();
    const device = {
      classList: { add: (value) => classes.add(value), remove: (value) => classes.delete(value) },
    };
    return {
      checked: /\bchecked\b/.test(markup),
      disabled: false,
      attributes: {},
      events: {},
      classes,
      closest(selector) {
        assert.equal(selector, '.device');
        return device;
      },
      addEventListener(event, handler) {
        this.events[event] = handler;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
    };
  });
  const counts = [...html.matchAll(/<(?:span|strong)\b[^>]*data-device-count[^>]*>/g)].map(() => ({
    textContent: '',
  }));
  assert.equal(toggles.length, 3);
  assert.equal(counts.length, 2);

  runInNewContext(source, {
    document: {
      querySelectorAll(selector) {
        return { '[data-device-toggle]': toggles, '[data-device-count]': counts }[selector];
      },
    },
    setTimeout(callback, delay) {
      timers.push({ callback, due: now + delay });
    },
  });

  return {
    toggles,
    timers,
    set(index, checked) {
      toggles[index].checked = checked;
      toggles[index].events.change();
    },
    expectCount(value) {
      counts.forEach((count) => assert.equal(count.textContent, String(value)));
    },
    advance(ms) {
      now += ms;
      const due = timers.filter((timer) => timer.due <= now);
      due.forEach((timer) => {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      });
    },
  };
}

for (const scenario of [
  { name: 'AC on', index: 1, initial: false, next: true, count: 3 },
  { name: 'fan off', index: 0, initial: true, next: false, count: 1 },
  { name: 'light off', index: 2, initial: true, next: false, count: 1 },
]) {
  test(`${scenario.name} applies only after 500ms`, () => {
    const dashboard = loadDashboard();
    const toggle = dashboard.toggles[scenario.index];
    dashboard.set(scenario.index, scenario.next);
    assert.equal(toggle.checked, scenario.initial);
    assert.equal(toggle.disabled, true);
    assert.equal(toggle.attributes['aria-busy'], 'true');
    assert.equal(toggle.classes.has('is-pending'), true);
    dashboard.expectCount(2);
    dashboard.advance(499);
    assert.equal(toggle.checked, scenario.initial);
    dashboard.expectCount(2);
    dashboard.advance(1);
    assert.equal(toggle.checked, scenario.next);
    assert.equal(toggle.disabled, false);
    assert.equal(toggle.attributes['aria-busy'], undefined);
    assert.equal(toggle.classes.has('is-pending'), false);
    dashboard.expectCount(scenario.count);
  });
}

test('Devices process independently and duplicate requests cannot create stale updates', () => {
  const dashboard = loadDashboard();
  dashboard.set(0, false);
  dashboard.set(0, true);
  assert.equal(dashboard.timers.length, 1);
  dashboard.advance(200);
  dashboard.set(1, true);
  dashboard.advance(300);
  assert.equal(dashboard.toggles[0].checked, false);
  assert.equal(dashboard.toggles[0].disabled, false);
  assert.equal(dashboard.toggles[1].checked, false);
  assert.equal(dashboard.toggles[1].disabled, true);
  dashboard.expectCount(1);
  dashboard.advance(200);
  assert.equal(dashboard.toggles[1].checked, true);
  dashboard.expectCount(2);
  dashboard.set(0, true);
  dashboard.advance(500);
  dashboard.expectCount(3);
});
