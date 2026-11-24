// UI acceptance test, run inside the headless preview:  preview.ps1 -Routes tasks -DumpDom -Prefs '{"persistEdits":true}' -Script (Get-Content ui-test.js -Raw)
// Results go to document.title ("PASS n/n" or the failures). Uses the fake host defined by preview.ps1 (objects, persistLog, exportLog).
const results = [];
const ok = (name, cond, info = '') => results.push((cond ? 'ok ' : 'FAIL ') + name + (cond || !info ? '' : ' (' + info + ')'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const byText = (sel, text) => Array.from(element.querySelectorAll(sel)).find(e => e.textContent.trim() === text || e.textContent.includes(text));
const type = (inp, v) => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };
const nav = id => { const b = Array.from(element.querySelectorAll('.mc-nav')).find(x => x.title === id); b.click(); };

(async () => {
  try {
    await wait(200);
    // 1. task create with validation, persisted when "Keep my edits" is on
    byText('.mc-btn', 'New task').click(); await wait(50);
    ok('task form opens as modal', !!element.querySelector('.mc-modal'));
    byText('.mc-modal-actions .mc-btn', 'Create').click(); await wait(50);
    ok('empty title is rejected', !!element.querySelector('.mc-modal .mc-error'));
    type(element.querySelector('[data-focus="tf-title"]'), 'UI test task 42'); await wait(20);
    byText('.mc-modal-actions .mc-btn', 'Create').click(); await wait(80);
    ok('modal closes after save', !element.querySelector('.mc-modal'));
    ok('new task visible on the board', element.textContent.includes('UI test task 42'));
    const ws = persistLog.filter(p => p.merge[0].objectName === 'workspace').pop();
    ok('workspace persisted with the task', !!ws && ws.merge[0].properties.json.includes('UI test task 42'));
    ok('audit entry recorded', !!ws && ws.merge[0].properties.json.includes('Created T'));

    // 2. reopen: a fresh visual instance reading the saved objects shows the task
    const el2 = document.createElement('div'); el2.style.cssText = 'position:absolute;left:-5000px;width:1600px;height:900px'; document.body.appendChild(el2);
    const inst2 = powerbi.visuals.plugins[Object.keys(powerbi.visuals.plugins)[0]].create({ element: el2, host: Object.assign({}, host, { persistProperties() {} }) });
    inst2.update({ viewport: { width: 1600, height: 900 }, dataViews: [{ table: { columns, rows }, metadata: { columns, objects } }] }); await wait(50);
    Array.from(el2.querySelectorAll('.mc-nav')).find(x => x.title === 'Task Manager').click(); await wait(50);
    ok('task survives reopen (saved in report)', el2.textContent.includes('UI test task 42'));
    el2.remove();

    // 3. command palette: Ctrl+K, search an order, Enter opens the inspector
    app().dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); await wait(50);
    ok('Ctrl+K opens palette', !!element.querySelector('.mc-palette'));
    type(element.querySelector('.mc-palette-input'), 'O00004'); await wait(50);
    ok('palette finds order O00004', !!byText('.mc-palette-row', 'O00004'));
    element.querySelector('.mc-palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(50);
    ok('Enter opens the order inspector', !!element.querySelector('.mc-drawer') && element.querySelector('.mc-drawer').textContent.includes('O00004'));
    app().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(30);
    ok('Escape closes the inspector', !element.querySelector('.mc-drawer'));
    app().dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); await wait(30);
    type(element.querySelector('.mc-palette-input'), 'zzzz-nothing'); await wait(30);
    ok('palette no-result state', !!element.querySelector('.mc-palette-empty'));
    app().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(30);

    // 4. theme switch persisted in prefs
    element.querySelector('.mc-theme-switch [title="Light theme"]').click(); await wait(50);
    const pf = persistLog.filter(p => p.merge[0].objectName === 'prefs').pop();
    ok('light theme saved in prefs', !!pf && JSON.parse(pf.merge[0].properties.json).theme === 'light');
    ok('light theme applied', !!element.querySelector('.mc-theme-light'));

    // 5. Data Doctor: mark reviewed is persisted
    nav('Data Doctor'); await wait(50);
    byText('.mc-btn', 'Mark reviewed').click(); await wait(50);
    const ws2 = persistLog.filter(p => p.merge[0].objectName === 'workspace').pop();
    ok('review mark persisted', ws2.merge[0].properties.json.includes('"reviewed":["'));

    // 6. Data Explorer: CSV export goes through the download service
    nav('Data Explorer'); await wait(50);
    byText('.mc-btn', 'Export CSV').click(); await wait(100);
    ok('CSV export via downloadService', exportLog.length === 1 && exportLog[0].n === 'sales_orders.csv' && exportLog[0].t === 'csv');

    // 7. What-if: slider changes outcome and marks the delta
    nav('What-If & Scenario Lab'); await wait(50);
    const r = element.querySelector('.mc-range'); r.value = '10'; r.dispatchEvent(new Event('input', { bubbles: true })); await wait(80);
    ok('what-if revenue +10% changes outcome', /\+/.test(element.querySelector('.mc-outlet').textContent) && !element.querySelector('.mc-error-box'));

    // 8. Department filter re-renders every module without errors
    const deptSel = element.querySelectorAll('.mc-ribbon select')[1]; deptSel.value = deptSel.options[2].value; deptSel.dispatchEvent(new Event('change')); await wait(50);
    const errs = [];
    for (const b of Array.from(element.querySelectorAll('.mc-nav'))) { const t = b.title; Array.from(element.querySelectorAll('.mc-nav')).find(x => x.title === t).click(); await wait(5); const e = element.querySelector('.mc-error-box'); if (e) { errs.push(t + ': ' + e.textContent.slice(0, 80)); } }
    ok('all modules render with a department filter', !errs.length, errs.join('; '));

    // 9. no network, no storage
    ok('no localStorage used', localStorage.length === 0);
  } catch (e) { results.push('FAIL exception ' + e.message); }
  const fails = results.filter(r => r.startsWith('FAIL'));
  document.title = (fails.length ? 'FAILED ' + fails.length + '/' + results.length + ': ' + fails.join(' | ') : 'PASS ' + results.length + '/' + results.length);
})();
