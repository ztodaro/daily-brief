#!/usr/bin/env node
// OAuth 2.0 PKCE flow for X API - one-time setup
// Run this, open the URL in a browser, authorize, paste the callback URL
import { execSync } from 'child_process';
import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import { URL } from 'url';

const getKeychain = (a) => execSync(`security find-generic-password -s "openclaw" -a "${a}" -w`).toString().trim();

// OAuth 2.0 Client ID = consumer key for confidential clients
const CLIENT_ID = process.env.X_CLIENT_ID || getKeychain('x-oauth2-client-id');
const CLIENT_SECRET = process.env.X_CLIENT_SECRET || getKeychain('x-oauth2-client-secret');

const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = 'tweet.read users.read bookmark.read offline.access';

// Generate PKCE
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
const state = randomBytes(16).toString('hex');

const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

console.log('\n🔗 Open this URL in your browser and authorize:\n');
console.log(authUrl);
console.log('\nWaiting for callback on localhost:3000...\n');

const server = createServer(async (req, res) => {
  if (!req.url.startsWith('/callback')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  if (returnedState !== state) {
    res.writeHead(400);
    res.end('State mismatch!');
    server.close();
    return;
  }

  // Exchange code for tokens
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  
  const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  const tokens = await tokenRes.json();

  if (tokens.access_token) {
    // Store in keychain
    execSync(`security add-generic-password -s "openclaw" -a "x-oauth2-access-token" -w "${tokens.access_token}" -U`);
    if (tokens.refresh_token) {
      execSync(`security add-generic-password -s "openclaw" -a "x-oauth2-refresh-token" -w "${tokens.refresh_token}" -U`);
    }
    console.log('✅ Tokens saved to Keychain!');
    console.log(`Access token expires in: ${tokens.expires_in}s`);
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>✅ Authorized! You can close this tab.</h1>');
  } else {
    console.error('❌ Token exchange failed:', tokens);
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>❌ Authorization failed</h1><pre>' + JSON.stringify(tokens, null, 2) + '</pre>');
  }

  server.close();
});

server.listen(3000);
