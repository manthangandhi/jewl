const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
].join(' ');

function formBody(params) {
  return new URLSearchParams(params).toString();
}

async function readJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status}`);
  }
  return response.json();
}

export function googleAuthUrl({ clientId, redirectUri, state } = {}) {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (state != null) url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCode({
  code,
  clientId,
  clientSecret,
  redirectUri,
  fetchImpl = globalThis.fetch
} = {}) {
  const tokenResponse = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    })
  });
  const tokens = await readJson(tokenResponse, 'token');
  const userResponse = await fetchImpl(USERINFO_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  const user = await readJson(userResponse, 'userinfo');
  return {
    googleSubjectId: user.sub,
    email: user.email,
    name: user.name,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    idToken: tokens.id_token
  };
}

export async function refreshAccessToken({
  refreshToken,
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch
} = {}) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const tokens = await readJson(response, 'refresh');
  return {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    refreshToken: tokens.refresh_token || refreshToken
  };
}
