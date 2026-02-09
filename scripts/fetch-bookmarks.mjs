#!/usr/bin/env node
// Fetch X bookmarks via Playwright browser automation
// Uses persistent context to maintain login session
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const getKeychain = (account) =>
  execSync(`security find-generic-password -s "openclaw" -a "${account}" -w`)
    .toString()
    .trim();

const username = getKeychain('x-username');
const password = getKeychain('x-password');

const outFile = process.argv[2] || '/tmp/x-bookmarks.json';
const userDataDir = join(process.env.HOME, '.x-browser-profile');

(async () => {
  // Use persistent context to keep cookies across runs
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Capture bookmark API responses
  const apiBookmarks = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/Bookmarks') && response.status() === 200) {
      try {
        const json = await response.json();
        apiBookmarks.push(json);
      } catch (e) {}
    }
  });

  // Check if already logged in
  console.log('Checking login state...');
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const currentUrl = page.url();
  const needsLogin = currentUrl.includes('login') || currentUrl.includes('flow');
  
  if (needsLogin) {
    console.log('Not logged in, performing login...');
    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Enter username
    console.log('Entering username...');
    try {
      const usernameInput = page.getByLabel('Phone, email, or username');
      await usernameInput.waitFor({ timeout: 15000 });
      await usernameInput.fill(username);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    } catch (e) {
      // Try alternative selector
      const input = page.locator('input[autocomplete="username"]');
      await input.fill(username);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }

    // Check for verification step
    try {
      const verifyInput = page.getByLabel('Phone or username');
      if (await verifyInput.isVisible({ timeout: 3000 })) {
        console.log('Verification step detected...');
        await verifyInput.fill(username);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    } catch (e) {}

    // Enter password
    console.log('Entering password...');
    try {
      const passwordInput = page.getByLabel('Password', { exact: true });
      await passwordInput.waitFor({ timeout: 10000 });
      await passwordInput.fill(password);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(5000);
    } catch (e) {
      const pwInput = page.locator('input[type="password"]');
      await pwInput.fill(password);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(5000);
    }
    
    console.log('Login complete. Current URL:', page.url());
  } else {
    console.log('Already logged in.');
  }

  // Navigate to bookmarks
  console.log('Navigating to bookmarks...');
  await page.goto('https://x.com/i/bookmarks', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Scroll to load more bookmarks
  console.log('Scrolling to load bookmarks...');
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(2000);
  }

  // Extract from DOM
  console.log('Extracting bookmarks from DOM...');
  const bookmarks = await page.evaluate(() => {
    const tweets = [];
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    articles.forEach((article) => {
      try {
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText : '';
        
        const timeEl = article.querySelector('time');
        const time = timeEl ? timeEl.getAttribute('datetime') : '';
        
        const links = article.querySelectorAll('a[href*="/status/"]');
        let url = '';
        for (const l of links) {
          const href = l.getAttribute('href');
          if (href && href.match(/\/status\/\d+$/)) {
            url = 'https://x.com' + href;
            break;
          }
        }
        
        const nameEl = article.querySelector('[data-testid="User-Name"]');
        const authorText = nameEl ? nameEl.innerText : '';
        const parts = authorText.split('\n');
        const author = parts[0] || '';
        const handle = (authorText.match(/@[\w]+/) || [''])[0];

        // Embedded links in tweet
        const embeddedLinks = [];
        if (textEl) {
          textEl.querySelectorAll('a').forEach(a => {
            if (a.href && !a.href.includes('x.com/search') && !a.href.includes('x.com/hashtag')) {
              embeddedLinks.push(a.href);
            }
          });
        }

        // Card links
        const cardLink = article.querySelector('[data-testid="card.wrapper"] a');
        const cardUrl = cardLink ? cardLink.href : '';
        
        tweets.push({
          author,
          handle,
          text: text.substring(0, 1500),
          time,
          url,
          embeddedLinks,
          cardUrl: cardUrl || undefined,
        });
      } catch (e) {}
    });
    return tweets;
  });

  // Also save any API responses we captured
  const result = {
    scrapedAt: new Date().toISOString(),
    bookmarkCount: bookmarks.length,
    bookmarks,
    apiResponses: apiBookmarks.length > 0 ? apiBookmarks : undefined,
  };

  console.log(`Found ${bookmarks.length} bookmarks`);
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`Saved to ${outFile}`);

  // Take a screenshot for debugging
  await page.screenshot({ path: '/tmp/x-bookmarks-screenshot.png', fullPage: false });
  console.log('Debug screenshot saved to /tmp/x-bookmarks-screenshot.png');

  await context.close();
})();
