#!/usr/bin/env node
// Fetch X bookmarks via API and save to JSON
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const getKeychain = (a) => execSync(`security find-generic-password -s "openclaw" -a "${a}" -w`).toString().trim();

async function refreshToken() {
  const clientId = getKeychain('x-oauth2-client-id');
  const clientSecret = getKeychain('x-oauth2-client-secret');
  const refreshToken = getKeychain('x-oauth2-refresh-token');
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const tokens = await res.json();
  if (tokens.access_token) {
    execSync(`security add-generic-password -s "openclaw" -a "x-oauth2-access-token" -w "${tokens.access_token}" -U`);
    if (tokens.refresh_token) {
      execSync(`security add-generic-password -s "openclaw" -a "x-oauth2-refresh-token" -w "${tokens.refresh_token}" -U`);
    }
    return tokens.access_token;
  }
  throw new Error('Token refresh failed: ' + JSON.stringify(tokens));
}

async function fetchBookmarks(token, userId) {
  const allBookmarks = [];
  let paginationToken = null;

  for (let page = 0; page < 10; page++) {
    let url = `https://api.x.com/2/users/${userId}/bookmarks?max_results=100&tweet.fields=created_at,author_id,text,entities,public_metrics&expansions=author_id&user.fields=name,username`;
    if (paginationToken) url += `&pagination_token=${paginationToken}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (res.status === 401) {
      // Token expired, refresh
      token = await refreshToken();
      return fetchBookmarks(token, userId);
    }

    const data = await res.json();
    if (!data.data) break;

    // Build author lookup
    const authors = {};
    if (data.includes?.users) {
      data.includes.users.forEach(u => { authors[u.id] = u; });
    }

    // Enrich tweets with author info
    data.data.forEach(tweet => {
      const author = authors[tweet.author_id] || {};
      tweet.author_name = author.name || '';
      tweet.author_username = author.username || '';
    });

    allBookmarks.push(...data.data);

    if (!data.meta?.next_token) break;
    paginationToken = data.meta.next_token;
  }

  return { token, bookmarks: allBookmarks };
}

(async () => {
  let token = getKeychain('x-oauth2-access-token');
  const userId = getKeychain('x-user-id');
  const outFile = process.argv[2] || '/tmp/x-bookmarks.json';

  // Filter to last 24 hours
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const { bookmarks } = await fetchBookmarks(token, userId);

  const recent = bookmarks.filter(b => new Date(b.created_at) >= cutoff);

  const result = {
    fetchedAt: new Date().toISOString(),
    cutoff: cutoff.toISOString(),
    totalBookmarks: bookmarks.length,
    recentCount: recent.length,
    bookmarks: recent,
  };

  writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`Fetched ${bookmarks.length} total, ${recent.length} from last 24h`);
  console.log(`Saved to ${outFile}`);
})();
