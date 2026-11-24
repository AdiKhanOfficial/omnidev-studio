/**
 * OmniDev Studio — Headless Browser Tools (Puppeteer)
 * 
 * Tools:
 *   take_screenshot     - Navigate to URL and capture a screenshot
 *   get_page_text       - Get visible text content from a URL or CSS selector
 *   get_page_console_errors - Collect console errors/warnings from a page
 *   click_element       - Click an element by CSS selector on a page
 * 
 * Uses a singleton browser instance to avoid launching new Chrome on every call.
 */

const path = require('path');
const fs = require('fs');
const workspaceManager = require('../workspace');

let puppeteer = null;
let browser = null;
let browserLaunchPromise = null;

/**
 * Lazy-load puppeteer — only imported if actually called (saves startup time).
 */
function requirePuppeteer() {
  if (!puppeteer) {
    try {
      puppeteer = require('puppeteer');
    } catch (err) {
      throw new Error(
        'Puppeteer is not installed. Run: npm install puppeteer\n' + err.message
      );
    }
  }
  return puppeteer;
}

/**
 * Get or launch a singleton headless browser instance.
 * Re-uses the same Chrome across multiple tool calls.
 */
async function getBrowser() {
  // If already launching, wait for that to finish
  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  // If browser is alive, reuse it
  if (browser) {
    try {
      // Test if still alive
      await browser.version();
      return browser;
    } catch (_) {
      browser = null;
    }
  }

  const pptr = requirePuppeteer();
  browserLaunchPromise = pptr.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ]
  }).then(b => {
    browser = b;
    browserLaunchPromise = null;
    console.log('[Browser] Headless Chrome launched');

    b.on('disconnected', () => {
      browser = null;
      browserLaunchPromise = null;
      console.log('[Browser] Headless Chrome disconnected');
    });

    return b;
  }).catch(err => {
    browserLaunchPromise = null;
    throw err;
  });

  return browserLaunchPromise;
}

/**
 * Resolve an output path relative to the workspace.
 * Creates parent directories automatically.
 */
function resolveOutputPath(outputPath) {
  const workspaceInfo = workspaceManager.getInfo();
  const workspaceRoot = workspaceInfo.path || process.cwd();

  // If absolute path provided, use it directly (security: must be in workspace)
  let resolved;
  if (path.isAbsolute(outputPath)) {
    resolved = outputPath;
  } else {
    resolved = path.join(workspaceRoot, outputPath);
  }

  // Create parent directory
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return resolved;
}

// ─── Tool Implementations ────────────────────────────────────────────────────

/**
 * Take a screenshot of a URL.
 */
async function take_screenshot({ url, output_path, width, height, full_page }) {
  if (!url) throw new Error('"url" is required');

  const viewportWidth = width || 1280;
  const viewportHeight = height || 800;
  const isFullPage = full_page === true;

  // Default output path
  const timestamp = Date.now();
  const safeFilename = url.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
  const defaultPath = path.join('screenshots', `${safeFilename}_${timestamp}.png`);
  const outPath = resolveOutputPath(output_path || defaultPath);

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setViewport({ width: viewportWidth, height: viewportHeight });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.screenshot({ path: outPath, fullPage: isFullPage });

    const stat = fs.statSync(outPath);
    const workspaceInfo = workspaceManager.getInfo();
    const relativePath = path.relative(workspaceInfo.path || process.cwd(), outPath);

    return {
      success: true,
      path: outPath,
      relative_path: relativePath,
      size_bytes: stat.size,
      dimensions: { width: viewportWidth, height: viewportHeight },
      full_page: isFullPage,
      url
    };
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Get text content from a URL (optionally a specific CSS selector).
 */
async function get_page_text({ url, selector }) {
  if (!url) throw new Error('"url" is required');

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const title = await page.title();

    let text;
    if (selector) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        text = await page.$eval(selector, el => el.innerText);
      } catch (err) {
        return {
          success: false,
          error: `Selector "${selector}" not found: ${err.message}`,
          title,
          url
        };
      }
    } else {
      text = await page.$eval('body', el => el.innerText);
    }

    return {
      success: true,
      text: text.trim().slice(0, 50000), // cap at 50k chars
      text_length: text.length,
      selector: selector || 'body',
      title,
      url
    };
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Collect console errors and warnings from a page.
 */
async function get_page_console_errors({ url, wait_ms }) {
  if (!url) throw new Error('"url" is required');

  const waitMs = wait_ms || 3000;
  const errors = [];
  const warnings = [];
  const all = [];

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      const entry = { type, text, location: msg.location() };
      all.push(entry);
      if (type === 'error') errors.push(entry);
      if (type === 'warning' || type === 'warn') warnings.push(entry);
    });

    page.on('pageerror', err => {
      const entry = { type: 'pageerror', text: err.message, stack: err.stack };
      errors.push(entry);
      all.push(entry);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for JS to execute
    await new Promise(resolve => setTimeout(resolve, waitMs));

    return {
      success: true,
      url,
      errors,
      warnings,
      all_messages: all,
      count: { errors: errors.length, warnings: warnings.length, total: all.length }
    };
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Click an element on a page by CSS selector.
 */
async function click_element({ url, selector, wait_for_navigation }) {
  if (!url) throw new Error('"url" is required');
  if (!selector) throw new Error('"selector" is required');

  const shouldWaitNav = wait_for_navigation !== false; // default true

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    await page.waitForSelector(selector, { timeout: 10000 });

    if (shouldWaitNav) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
        page.click(selector)
      ]);
    } else {
      await page.click(selector);
    }

    const urlAfter = page.url();
    const titleAfter = await page.title();

    return {
      success: true,
      selector,
      url_before: url,
      url_after: urlAfter,
      title_after: titleAfter,
      navigated: urlAfter !== url
    };
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Close the shared browser instance (called on app shutdown).
 */
async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (_) {}
    browser = null;
  }
}

module.exports = {
  take_screenshot,
  get_page_text,
  get_page_console_errors,
  click_element,
  closeBrowser
};
