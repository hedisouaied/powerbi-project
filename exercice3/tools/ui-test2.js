// Second UI acceptance set (features 2, 3, 8, 9, 12, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 29).
// Run: preview.ps1 -Routes command -DumpDom -Script (Get-Content ui-test2.js -Raw)   -> document.title = PASS n/n or failures
const results = [];
const ok = (name, cond, info = '') => results.push((cond ? 'ok ' : 'FAIL ') + name + (cond || !info ? '' : ' (' + info + ')'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const all = sel => Array.from(element.querySelectorAll(sel));
const byText = (sel, text) => all(sel).find(e => e.textContent.trim() === text) || all(sel).find(e => e.textContent.includes(text));
const byTitle = (sel, t) => all(sel).find(e => e.getAttribute('title') === t);
const type = (inp, v) => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };
const nav = label => { all('.mc-nav').find(x => x.title === label).click(); };
const outlet = () => element.querySelector('.mc-outlet').textContent;
const noErr = () => !element.querySelector('.mc-error-box');

(async () => {
  try {
    await wait(200);
    // 3 dashboard builder
    const n0 = all('.mc-widget').length;
    byText('.mc-btn', 'Customize').click(); await wait(30);
    ok('3 edit mode shows widget toolbars', all('.mc-widget-edit').length === n0);
    all('.mc-widget')[1].querySelector('.mc-size:nth-of-type(3)')?.click(); all('.mc-size').filter(b => b.textContent === 'L')[1].click(); await wait(30);
    ok('3 resize widget to L', all('.mc-widget')[1].classList.contains('mc-w-l'));
    const rm = all('.mc-widget-edit')[2].querySelector('[title^="Remove"], [aria-label^="Remove"]'); rm.click(); await wait(30);
    ok('3 remove widget', all('.mc-widget').length === n0 - 1);
    byText('.mc-btn', 'Reset layout').click(); await wait(30);
    ok('3 reset layout', all('.mc-widget').length === n0 && !all('.mc-widget')[1].classList.contains('mc-w-l'));
    byText('.mc-btn', 'Done').click(); await wait(30);

    // 2 notifications
    const unread0 = Number(element.querySelector('.mc-bell .mc-badge').textContent);
    nav('Notifications'); await wait(30);
    byText('.mc-tab', 'Unread').click(); await wait(30);
    byTitle('.mc-icon-btn', 'Mark read').click(); await wait(30);
    ok('2 mark read lowers the unread badge', Number(element.querySelector('.mc-bell .mc-badge').textContent) === unread0 - 1);
    byTitle('.mc-icon-btn', 'Archive').click(); await wait(30);
    byText('.mc-tab', 'Archived').click(); await wait(30);
    ok('2 archived filter lists it', all('.mc-notif-archived').length >= 1);

    // 12 decisions
    nav('Decision Register'); await wait(30);
    const d0 = outlet();
    byText('.mc-btn', 'Register decision').click(); await wait(30);
    type(element.querySelector('.mc-modal input[placeholder="Why we expect this impact"]'), 'UI test decision'); await wait(10);
    byText('.mc-modal-actions .mc-btn', 'Register').click(); await wait(50);
    ok('12 decision registered', !element.querySelector('.mc-modal') && noErr() && outlet() !== d0);

    // 15 approvals
    nav('Approvals'); await wait(30);
    byText('.mc-btn', 'Submit request').click(); await wait(30);
    const amt = element.querySelector('.mc-modal input[type="number"]'); type(amt, '0');
    byText('.mc-modal-actions .mc-btn', 'Submit').click(); await wait(30);
    ok('15 invalid amount rejected', !!element.querySelector('.mc-modal .mc-error'));
    type(element.querySelector('.mc-modal input[type="number"]'), '12500');
    byText('.mc-modal-actions .mc-btn', 'Submit').click(); await wait(50);
    ok('15 request submitted', !element.querySelector('.mc-modal'));
    const appr = byTitle('.mc-btn', 'Approve'); appr.click(); await wait(50);
    ok('15 approve changes state', noErr() && /Approved/.test(element.textContent));

    // 18 collaboration
    nav('Collaboration'); await wait(30);
    const ta = element.querySelector('[data-focus="col-text"]'); type(ta, 'UI test comment @'); await wait(30);
    ok('18 @mention suggestions appear', !!element.querySelector('.mc-mentions'));
    const ta2 = element.querySelector('[data-focus="col-text"]'); type(ta2, 'UI test comment'); await wait(20);
    byText('.mc-btn', 'Post comment').click(); await wait(50);
    ok('18 comment posted', outlet().includes('UI test comment'));

    // 17 audit log shows my actions
    nav('Audit Log'); await wait(30);
    ok('17 audit shows session actions', /Approvals|Decision|Collaboration/.test(outlet()) && noErr());

    // 26 missions filter
    nav('Missions'); await wait(30);
    const m0 = all('.mc-mission-card').length;
    byText('.mc-stat-card', 'Blocked').click(); await wait(30);
    const m1 = all('.mc-mission-card');
    ok('26 blocked filter', m1.length > 0 && m1.length < m0 && m1.every(x => x.textContent.includes('Blocked')), m0 + '->' + m1.length);

    // 23 story
    nav('Data Storytelling'); await wait(30);
    const s0 = element.querySelector('.mc-story-step').textContent; byText('.mc-btn', 'Next').click(); await wait(30);
    ok('23 next slide', element.querySelector('.mc-story-step').textContent !== s0);

    // 24 compare
    nav('Comparison Studio'); await wait(30);
    const c0 = outlet(); byText('.mc-btn', 'Swap').click(); await wait(30);
    ok('24 compare + swap', noErr() && outlet() !== c0 && !!element.querySelector('.mc-win'));

    // 25 crisis presets
    nav('Crisis Simulator'); await wait(30);
    const k0 = outlet(); byText('.mc-tab', 'Cost surge').click(); await wait(30);
    ok('25 crisis template changes impact', outlet() !== k0 && noErr());

    // 29 sandbox
    nav('Business Sandbox'); await wait(30);
    const sb0 = outlet(); const num = element.querySelector('.mc-outlet input[type="number"]'); type(num, String(Number(num.value) * 2)); num.dispatchEvent(new Event('change', { bubbles: true })); await wait(40);
    const sb1 = outlet();
    byText('.mc-btn', 'Reset sandbox').click(); await wait(30);
    ok('29 sandbox edit changes totals, reset restores', sb1 !== sb0 && outlet() === sb0, (sb1 !== sb0) + '/' + (outlet() === sb0));

    // 8 time machine step
    nav('Time Machine'); await wait(30);
    const t0 = element.querySelector('.mc-tm-date').textContent; byTitle('.mc-btn', 'Step back')?.click() || all('.mc-tm-controls .mc-btn')[0].click(); await wait(30);
    ok('8 step changes the date', element.querySelector('.mc-tm-date').textContent !== t0);

    // 16 calendar views
    nav('Calendar'); await wait(30);
    const views = ['Week', 'Day', 'Agenda', 'Timeline', 'Month']; let vok = true;
    for (const v of views) { byText('.mc-tab', v).click(); await wait(20); if (!noErr()) { vok = false; } }
    ok('16 five calendar views render', vok);

    // 19 3D: click a building opens the department inspector
    nav('Digital Twin 2D/3D'); await wait(30);
    byText('.mc-tab', '3D environment').click(); await wait(30);
    all('.mc-block')[0].click(); await wait(40);
    ok('19 3D building opens inspector', !!element.querySelector('.mc-drawer'));
    app().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(20);

    // 21 geo
    nav('Geo Intelligence'); await wait(30);
    byText('.mc-tile', 'Sfax').click(); await wait(30);
    ok('21 region select lists customers', /Sfax . customers/.test(outlet()));

    // 20 network path
    nav('Network Graph'); await wait(30);
    const sels = all('.mc-outlet select').slice(-2); sels[0].value = sels[0].options[1].value; sels[0].dispatchEvent(new Event('change')); await wait(30);
    const sels2 = all('.mc-outlet select').slice(-2); sels2[1].value = sels2[1].options[5].value; sels2[1].dispatchEvent(new Event('change')); await wait(60);
    ok('20 path explorer answers', noErr() && (all('.mc-node-path').length > 0 || /No path/i.test(outlet())));

    // 9 root cause
    nav('Root Cause'); await wait(30);
    ok('9 root cause ranks contributors', noErr() && all('.mc-outlet .mc-chart').length > 0);
  } catch (e) { results.push('FAIL exception ' + e.message); }
  const fails = results.filter(r => r.startsWith('FAIL'));
  document.title = (fails.length ? 'FAILED ' + fails.length + '/' + results.length + ': ' + fails.join(' | ') : 'PASS ' + results.length + '/' + results.length);
})();
