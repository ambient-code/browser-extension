const OAUTH_DEFAULT_ISSUER = 'https://sso.redhat.com/auth/realms/redhat-external';
const OAUTH_CLIENT_ID = 'ocm-cli';

function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ALLOWED_ISSUER_HOSTS = ['sso.redhat.com', 'sso.stage.redhat.com'];

function validateIssuerUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Issuer URL must use HTTPS');
    if (!ALLOWED_ISSUER_HOSTS.includes(parsed.hostname)) {
      throw new Error(`Issuer hostname "${parsed.hostname}" is not in the allowlist`);
    }
  } catch (e) {
    if (e.message.startsWith('Issuer')) throw e;
    throw new Error('Invalid issuer URL: ' + url);
  }
}

async function oauthLogin(serverUrl, issuerUrl) {
  issuerUrl = issuerUrl || OAUTH_DEFAULT_ISSUER;
  validateIssuerUrl(issuerUrl);

  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64urlEncode(verifierBytes.buffer);
  const challengeHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64urlEncode(challengeHash);

  const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)).buffer);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: 'openid',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  const authUrl = `${issuerUrl}/protocol/openid-connect/auth?${params}`;

  const redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });

  const redirectParams = new URL(redirectUrl).searchParams;
  if (redirectParams.get('error')) {
    throw new Error(redirectParams.get('error_description') || redirectParams.get('error'));
  }
  if (redirectParams.get('state') !== state) {
    throw new Error('OAuth state mismatch');
  }
  const code = redirectParams.get('code');

  const tokenRes = await fetch(`${issuerUrl}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: chrome.identity.getRedirectURL(),
      client_id: OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${tokenRes.status}`);
  }
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token || typeof tokenData.access_token !== 'string') {
    throw new Error('Token response missing access_token');
  }
  if (!tokenData.expires_in || typeof tokenData.expires_in !== 'number' || tokenData.expires_in <= 0) {
    throw new Error('Token response has invalid expires_in');
  }

  await chrome.storage.local.set({
    oauthTokens: {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      issuer_url: issuerUrl,
    },
    baseUrl: serverUrl,
  });

  return true;
}

async function oauthRefreshToken() {
  const { oauthTokens: tokens } = await chrome.storage.local.get('oauthTokens');
  if (!tokens || !tokens.refresh_token) return null;
  if (!tokens.issuer_url) return null;
  try { validateIssuerUrl(tokens.issuer_url); } catch (_) { return null; }

  let res;
  try {
    res = await fetch(`${tokens.issuer_url}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: OAUTH_CLIENT_ID,
      }),
    });
  } catch (e) {
    await chrome.storage.local.remove('oauthTokens');
    try { chrome.runtime.sendMessage({ type: 'AUTH_EXPIRED' }); } catch (_) {}
    return null;
  }

  if (!res.ok) {
    await chrome.storage.local.remove('oauthTokens');
    try { chrome.runtime.sendMessage({ type: 'AUTH_EXPIRED' }); } catch (_) {}
    return null;
  }

  const data = await res.json();
  await chrome.storage.local.set({
    oauthTokens: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      issuer_url: tokens.issuer_url,
    },
  });
  return data.access_token;
}

async function oauthGetToken() {
  const { oauthTokens: tokens } = await chrome.storage.local.get('oauthTokens');
  if (!tokens || !tokens.access_token) return null;

  // Refresh if expired or within 60s of expiry
  if (tokens.expires_at - 60000 < Date.now()) {
    return oauthRefreshToken();
  }
  return tokens.access_token;
}

async function oauthLogout() {
  await chrome.storage.local.remove('oauthTokens');
  try { await chrome.identity.clearAllCachedAuthTokens(); } catch (_) {}
}

async function isAuthenticated() {
  const { oauthTokens: tokens } = await chrome.storage.local.get('oauthTokens');
  if (!tokens) return false;

  if (tokens.expires_at > Date.now()) return true;

  if (tokens.refresh_token) {
    const refreshed = await oauthRefreshToken();
    return refreshed !== null;
  }
  return false;
}
