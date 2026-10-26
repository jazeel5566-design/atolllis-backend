// Account security, through the real API on the dev branch: lockout, disabling, password rules,
// passwords set by someone else, sessions ending when an account changes, and the headers.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../src/app');
const { setup, teardown, as, USER_PREFIX } = require('./fixtures');
const { MAX_FAILED_LOGINS } = require('../../src/utils/password');

let fx;
before(async () => { fx = await setup(); });
after(teardown);

const login = (username, password) => request(app).post('/api/auth/login').send({ username, password });

// A lab manager creates a phlebotomist; the new account must choose its own password first.
async function newStaff(tag) {
  const username = `${USER_PREFIX}${tag}_${fx.suffix}`;
  const firstPassword = `first-pass-${fx.suffix}`;
  const created = await as(fx.tokens.manager).post('/api/users', { name: `ZZ Test ${tag}`, username, password: firstPassword, role: 'phlebotomist' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.mustChangePassword, true);
  const first = await login(username, firstPassword);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const ownPassword = `own-pass-${fx.suffix}`;
  const changed = await as(first.body.token).post('/api/auth/change-password', { currentPassword: firstPassword, newPassword: ownPassword });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  return { id: created.body.id, username, password: ownPassword, token: changed.body.token };
}

describe('password rules', () => {
  it('a new account needs at least 10 characters, not containing the username', async () => {
    const short = await as(fx.tokens.manager).post('/api/users', { name: 'ZZ Test short', username: `${USER_PREFIX}short_${fx.suffix}`, password: 'nine-char', role: 'phlebotomist' });
    assert.equal(short.status, 400);
    const username = `${USER_PREFIX}named_${fx.suffix}`;
    const named = await as(fx.tokens.manager).post('/api/users', { name: 'ZZ Test named', username, password: `${username}-123`, role: 'phlebotomist' });
    assert.equal(named.status, 400);
  });

  it('a password set by someone else blocks everything until the owner changes it', async () => {
    const username = `${USER_PREFIX}fresh_${fx.suffix}`;
    const password = `first-pass-${fx.suffix}`;
    const created = await as(fx.tokens.manager).post('/api/users', { name: 'ZZ Test fresh', username, password, role: 'phlebotomist' });
    assert.equal(created.status, 201);
    const first = await login(username, password);
    assert.equal(first.body.user.mustChangePassword, true);
    const blocked = await as(first.body.token).get('/api/orders');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.mustChangePassword, true);
    const same = await as(first.body.token).post('/api/auth/change-password', { currentPassword: password, newPassword: password });
    assert.equal(same.status, 400);
    const wrong = await as(first.body.token).post('/api/auth/change-password', { currentPassword: 'not-the-password', newPassword: `own-pass-${fx.suffix}` });
    assert.equal(wrong.status, 400); // 400, not 401: a typo must not log the person out
    const ok = await as(first.body.token).post('/api/auth/change-password', { currentPassword: password, newPassword: `own-pass-${fx.suffix}` });
    assert.equal(ok.status, 200);
    assert.equal((await as(ok.body.token).get('/api/orders')).status, 200);
    assert.equal((await as(first.body.token).get('/api/orders')).status, 401); // the old token ended
  });
});

describe('lockout after wrong passwords', () => {
  let staff;
  before(async () => { staff = await newStaff('lock'); });

  it(`locks the account at the ${MAX_FAILED_LOGINS}th wrong password, and refuses even the right one`, async () => {
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) assert.equal((await login(staff.username, 'wrong-password')).status, 401);
    assert.equal((await login(staff.username, 'wrong-password')).status, 423);
    const right = await login(staff.username, staff.password);
    assert.equal(right.status, 423);
    assert.match(right.body.error, /locked until/);
  });

  it('a lab manager can unlock it', async () => {
    const listed = (await as(fx.tokens.manager).get('/api/users')).body.find(u => u.id === staff.id);
    assert.equal(listed.locked, true);
    const unlocked = await as(fx.tokens.manager).put(`/api/users/${staff.id}`, { unlock: true });
    assert.equal(unlocked.status, 200);
    assert.equal(unlocked.body.locked, false);
    assert.equal((await login(staff.username, staff.password)).status, 200);
  });
});

describe('sessions end when the account changes', () => {
  let staff;
  before(async () => { staff = await newStaff('sess'); });

  it('a role change applies to the very next request, without logging out', async () => {
    assert.equal((await as(staff.token).get('/api/instruments/messages')).status, 403); // phlebotomists cannot process
    const changed = await as(fx.tokens.manager).put(`/api/users/${staff.id}`, { role: 'technologist' });
    assert.equal(changed.status, 200);
    assert.equal((await as(staff.token).get('/api/instruments/messages')).status, 200);
  });

  it('disabling the account ends its sessions and blocks login', async () => {
    assert.equal((await as(fx.tokens.manager).put(`/api/users/${staff.id}`, { active: false })).status, 200);
    assert.equal((await as(staff.token).get('/api/orders')).status, 401);
    assert.equal((await login(staff.username, staff.password)).status, 403);
    assert.equal((await as(fx.tokens.manager).put(`/api/users/${staff.id}`, { active: true })).status, 200);
    const back = await login(staff.username, staff.password);
    assert.equal(back.status, 200);
    staff.token = back.body.token;
  });

  it('a password reset ends existing sessions and makes the owner choose a new one', async () => {
    const reset = await as(fx.tokens.manager).put(`/api/users/${staff.id}`, { newPassword: `reset-pass-${fx.suffix}` });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.mustChangePassword, true);
    assert.equal((await as(staff.token).get('/api/orders')).status, 401);
  });

  it('nobody can disable their own account', async () => {
    const me = (await as(fx.tokens.manager).get('/api/users')).body.find(u => u.username.startsWith(`${USER_PREFIX}manager_`));
    assert.equal((await as(fx.tokens.manager).put(`/api/users/${me.id}`, { active: false })).status, 400);
  });
});

describe("a lab manager cannot take over an administrator's account", () => {
  it('cannot reset, disable or remove it', async () => {
    const adminUser = (await as(fx.tokens.manager).get('/api/users')).body.find(u => u.username.startsWith(`${USER_PREFIX}admin_`));
    assert.ok(adminUser, 'the test admin is at the same facility as the test lab manager');
    assert.equal((await as(fx.tokens.manager).put(`/api/users/${adminUser.id}`, { newPassword: `takeover-${fx.suffix}` })).status, 403);
    assert.equal((await as(fx.tokens.manager).put(`/api/users/${adminUser.id}`, { active: false })).status, 403);
    assert.equal((await as(fx.tokens.manager).post(`/api/users/${adminUser.id}/facility-access`, { facilityId: fx.facilities.regional.id })).status, 403);
  });

  it('an administrator still can', async () => {
    const managerUser = (await as(fx.tokens.admin).get('/api/users')).body.find(u => u.username.startsWith(`${USER_PREFIX}manager_`));
    const res = await as(fx.tokens.admin).put(`/api/users/${managerUser.id}`, { name: 'ZZ Test manager (renamed)' });
    assert.equal(res.status, 200);
  });
});

describe('headers', () => {
  it('sends a content security policy that still allows the page to run', async () => {
    const res = await request(app).get('/api/health');
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /script-src 'self' 'unsafe-inline'/);
    assert.match(csp, /script-src-attr 'unsafe-inline'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('does not let another website call the API from a browser', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://example.org');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('counts login attempts per network', async () => {
    const res = await login('nobody-zz-test', 'wrong');
    assert.ok(res.headers['ratelimit-policy'], 'rate-limit policy header present');
  });
});
