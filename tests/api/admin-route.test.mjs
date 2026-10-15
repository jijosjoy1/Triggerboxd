import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseAdminPaging, adminHasMore, ADMIN_PAGE_LIMIT, ADMIN_MAX_LIMIT, ADMIN_MAX_OFFSET} from '../../src/lib/admin.ts';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');

test('pagination defaults are applied when the query is absent', () => {
  assert.deepEqual(parseAdminPaging(null, null), {ok: true, limit: ADMIN_PAGE_LIMIT, offset: 0});
  assert.deepEqual(parseAdminPaging('3', '6'), {ok: true, limit: 3, offset: 6});
  assert.deepEqual(parseAdminPaging('1', '0'), {ok: true, limit: 1, offset: 0});
  assert.deepEqual(parseAdminPaging(String(ADMIN_MAX_LIMIT), String(ADMIN_MAX_OFFSET)), {ok: true, limit: ADMIN_MAX_LIMIT, offset: ADMIN_MAX_OFFSET});
});

test('out-of-range and malformed pagination is refused', () => {
  for (const [limit, offset] of [['0', null], ['26', null], ['-1', null], ['abc', null], ['1.5', null], [null, '-1'], [null, 'x'], [null, '99999'], ['', null], ['0001e2', null]]) {
    assert.deepEqual(parseAdminPaging(limit, offset), {ok: false}, `limit=${limit} offset=${offset}`);
  }
});

test('pagination continues while any recent list has older rows', () => {
  const totals = {accounts: {total: 11}, films: {total: 3}, assessments: {total: 0}};
  assert.equal(adminHasMore(totals, 0, 5), true);
  assert.equal(adminHasMore(totals, 5, 5), true);
  assert.equal(adminHasMore(totals, 10, 5), false);
  assert.equal(adminHasMore({accounts: {total: 0}, films: {total: 12}, assessments: {total: 0}}, 5, 5), true);
  assert.equal(adminHasMore({accounts: {total: 0}, films: {total: 0}, assessments: {total: 12}}, 5, 5), true);
  assert.equal(adminHasMore({accounts: {total: 9999}, films: {total: 0}, assessments: {total: 0}}, ADMIN_MAX_OFFSET, 5), false);
});

test('the route enforces authentication and delegates authorisation to the database', () => {
  const route = read('src/app/api/v1/admin/overview/route.ts');
  assert.match(route, /requireActiveUser/);
  assert.match(route, /rpc\('get_admin_overview'/);
  assert.match(route, /parseAdminPaging/);
  // The handler never reads a role, owner flag or identity from client input.
  assert.doesNotMatch(route, /searchParams.get\('(?!limit|offset)[a-z_]+'\)/i);
  assert.doesNotMatch(route, /user_metadata|display_name|nickname|email/);
});
