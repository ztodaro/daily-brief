#!/usr/bin/env node
// OAuth 2.0 PKCE flow - manual callback URL paste version
import { execSync } from 'child_process';
import { randomBytes, createHash } from 'crypto';
import { createInterface } from 'readline';
import { URL } from 'url';

const getKeychain = (a) => execSync(`security find-generic-password -s "openclaw" -a "${a}" -w`).toString().trim();

const CLIENT_ID = getKeychain('x-oauth2-client-id');
const CLIENT_SECRET = getKeychain('x-oauth2-client-secret');
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = 'tweet.read users.read bookmark.read offline.access';

const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
const state = randomBytes(16).toString('hex');

const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

console.log('AUTH_URL=' + authUrl);
console.log('STATE=' + state);
console.log('VERIFIER=' + codeVerifier);
console.log('WAITING_FOR_CODE');

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const input = line.trim();
  let code;
  
  try {
    // Try parsing as full URL
    const url = new URL(input.startsWith('http') ? input : 'http://localhost:3000/callback?' + input);
    code = url.searchParams.get('code');
  } catch {
    // Treat as raw code
    code = input;
  }

  if (!code) {
    console.log('ERROR: No code found');
    return;
  }

  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  
  try {
    const res = await fetch('https://api.x.com/2/oauth2/token', {
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

    const tokens = await res.json();

    if (tokens.access_token) {
      execSync(`security add-generic-password -s "openclaw" -a "x-oauth2-access-token" -w "${tokens.access_token}" -U`);
      if (tokens.refresh_token) {
        execSync(`security add-generic-password -s "openclaw" -a "x-oauth2-refresh-token" -w "${tokens.refresh_token}" -U`);
      }
      console.log('SUCCESS: Tokens saved. Expires in ' + tokens.expires_in + 's');
    } else {
      console.log('ERROR: ' + JSON.stringify(tokens));
    }
  } catch (e) {
    console.log('ERROR: ' + e.message);
  }
  
  rl.close();
  process.exit(0);
});
