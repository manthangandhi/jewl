import test from 'node:test';
import assert from 'node:assert/strict';
import { googleAuthUrl, exchangeCode, refreshAccessToken } from '../src/oauth.js';
import { SessionStore } from '../src/session.js';

test('auth URL includes drive.file and spreadsheets scopes', () => {
  const url = googleAuthUrl({ clientId: 'cid', redirectUri: 'http://localhost:3000/auth/google/callback', state: 'abc' });
  assert.match(url, /accounts.google.com/);
  assert.match(url, /spreadsheets/);
  assert.match(url, /drive.file/);
  assert.match(url, /openid/);
});

test('exchangeCode stores tokens from mocked token endpoint', async () => {
  const fetchImpl = async (url, options) => {
    if (String(url).includes('token')) {
      return { ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: 'x' }) };
    }
    if (String(url).includes('userinfo')) {
      return { ok: true, json: async () => ({ sub: 'sub-1', email: 'owner@shop.com', name: 'Owner' }) };
    }
    throw new Error(url);
  };
  const result = await exchangeCode({ code: 'code', clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://localhost:3000/auth/google/callback', fetchImpl });
  assert.equal(result.googleSubjectId, 'sub-1');
  assert.equal(result.email, 'owner@shop.com');
  assert.equal(result.refreshToken, 'rt');
});

test('refreshAccessToken posts grant_type=refresh_token', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return { ok: true, json: async () => ({ access_token: 'new-at', expires_in: 3600 }) };
  };
  const result = await refreshAccessToken({
    refreshToken: 'rt',
    clientId: 'cid',
    clientSecret: 'sec',
    fetchImpl
  });
  assert.match(captured.url, /oauth2.googleapis.com\/token/);
  assert.equal(captured.options.method, 'POST');
  assert.match(captured.options.body, /grant_type=refresh_token/);
  assert.match(captured.options.body, /refresh_token=rt/);
  assert.equal(result.accessToken, 'new-at');
});

test('session cookie round-trips owner identity', () => {
  const sessions = new SessionStore();
  const { header } = sessions.create({ googleSubjectId: 'sub-1', email: 'a@b.com' });
  assert.match(header, /HttpOnly/i);
  const sid = header.split('karigar.sid=')[1].split(';')[0];
  assert.equal(sessions.get(sid).email, 'a@b.com');
});
