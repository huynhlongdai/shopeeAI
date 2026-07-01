import http from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

loadDotEnv(path.join(rootDir, '.env'));

const PORT = numberFromEnv('PORT', 8787);
const HOST = process.env.HOST || '127.0.0.1';
const API_TOKEN = process.env.API_TOKEN || '';
const USER_DATA_DIR = path.resolve(rootDir, process.env.SHOPEE_USER_DATA_DIR || '.shopee-browser');
const CUSTOM_LINK_URL =
  process.env.SHOPEE_CUSTOM_LINK_URL || 'https://affiliate.shopee.vn/offer/custom_link';
const SHOPEE_HOME_URL = process.env.SHOPEE_HOME_URL || 'https://shopee.vn/';
const HEADLESS = (process.env.SHOPEE_BROWSER_HEADLESS || 'true').toLowerCase() !== 'false';
const BROWSER_CHANNEL = process.env.SHOPEE_BROWSER_CHANNEL || 'chrome';
const EXTENSION_JOB_TIMEOUT_MS = numberFromEnv('EXTENSION_JOB_TIMEOUT_MS', 10 * 60 * 1000);
const MAX_LINKS = 5;
const SUB_ID_KEYS = ['subId1', 'subId2', 'subId3', 'subId4', 'subId5'];

let browserContext;
let page;
let shopPage;
let queue = Promise.resolve();
let latestBrowserProductData;
let extensionJobs = [];
let extensionJobCounter = 0;
let extensionProfiles = new Map();
let facebookJobs = [];
let facebookJobCounter = 0;
let facebookProfiles = new Map();
let aiDiagnostics = [];
let facebookSettings = {
  defaultTargetUrl: normalizeFacebookTargetUrl(process.env.FACEBOOK_DEFAULT_TARGET_URL),
  publishMode: normalizePublishMode(process.env.FACEBOOK_PUBLISH_MODE || 'draft'),
  cooldownMinutes: numberFromEnv('FACEBOOK_COOLDOWN_MINUTES', 45),
  jitterMinutes: numberFromEnv('FACEBOOK_JITTER_MINUTES', 10),
  maxPostsPerDay: numberFromEnv('FACEBOOK_MAX_POSTS_PER_DAY', 12),
  updatedAt: '',
  updatedBy: '',
};

if (process.argv.includes('--login')) {
  await login();
  process.exit(0);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || 'Internal server error',
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`shopeeAI API listening on http://${HOST}:${PORT}`);
});

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || HOST}`);
  const pathname = requestUrl.pathname;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/affiliate-links') {
    assertAuthorized(req);
    const body = await readJson(req);
    const input = normalizeInput(body);

    const result = await enqueue(() => createAffiliateLinks(input));
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/product-info') {
    assertAuthorized(req);
    const body = await readJson(req);
    const result = await enqueue(() => getProductInfo(normalizeProductInfoInput(body)));
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/product-data') {
    assertAuthorized(req);
    const body = await readJson(req);
    const result = await enqueue(() => getProductData(normalizeProductInfoInput(body)));
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shopee/product-id') {
    assertAuthorized(req);
    const url = requestUrl.searchParams.get('url') || requestUrl.searchParams.get('link') || '';
    const resolve = truthyQuery(requestUrl.searchParams.get('resolve'));
    const result = await getProductId(normalizeProductInfoInput({ url }), { resolve });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/product-id') {
    assertAuthorized(req);
    const body = await readJson(req);
    const result = await getProductId(normalizeProductInfoInput(body), { resolve: Boolean(body.resolve) });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/product-ids') {
    assertAuthorized(req);
    const body = await readJson(req);
    const inputs = normalizeProductIdBatchInput(body);
    const products = [];
    for (const input of inputs) {
      products.push(await getProductId(input, { resolve: Boolean(body.resolve) }));
    }
    sendJson(res, 200, { ok: true, products, count: products.length });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/browser-product-data') {
    assertAuthorized(req);
    const body = await readJson(req);
    const result = normalizeBrowserProductData(body);
    latestBrowserProductData = result;
    sendJson(res, 200, { ok: true, productData: result });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/facebook/embed') {
    assertAuthorized(req);
    const body = await readJson(req);
    const result = createFacebookPostEmbed(body);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/facebook/extract-shopee-links') {
    assertAuthorized(req);
    const body = await readJson(req);
    const links = extractShopeeLinksFromFacebookPayload(body);
    sendJson(res, 200, { ok: true, links, count: links.length });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/ai/diagnostics/report') {
    assertAuthorized(req);
    const body = await readJson(req);
    const report = createAiDiagnosticReport(body);
    sendJson(res, 200, { ok: true, report });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/ai/diagnostics/latest') {
    assertAuthorized(req);
    const limit = Math.min(numberFromQuery(requestUrl.searchParams.get('limit'), 10), 100);
    sendJson(res, 200, {
      ok: true,
      reports: aiDiagnostics.slice(-limit).reverse(),
      latest: aiDiagnostics.at(-1) || null,
      total: aiDiagnostics.length,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/facebook/jobs') {
    assertAuthorized(req);
    const body = await readJson(req);
    const job = createFacebookJobFromBody(body);
    sendJson(res, 202, { ok: true, job });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/social/facebook/jobs') {
    assertAuthorized(req);
    const limit = Math.min(numberFromQuery(requestUrl.searchParams.get('limit'), 50), 200);
    const status = String(requestUrl.searchParams.get('status') || '').trim();
    const jobs = status ? facebookJobs.filter((job) => job.status === status) : facebookJobs;
    sendJson(res, 200, { ok: true, jobs: jobs.slice(-limit).reverse(), total: jobs.length });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/social/facebook/profiles') {
    assertAuthorized(req);
    sendJson(res, 200, { ok: true, profiles: [...facebookProfiles.values()] });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/social/facebook/jobs/next') {
    assertAuthorized(req);
    const profileId = normalizeProfileId(requestUrl.searchParams.get('profileId'));
    if (profileId) {
      upsertFacebookProfile({
        profileId,
        profileName: requestUrl.searchParams.get('profileName') || undefined,
        extensionVersion: requestUrl.searchParams.get('extensionVersion') || undefined,
        state: 'polling',
      });
    }
    const now = Date.now();
    const job = facebookJobs.find((row) =>
      row.status === 'queued'
        && facebookJobMatchesProfile(row, profileId)
        && facebookJobIsSchedulable(row, now),
    );
    if (!job) {
      sendJson(res, 200, { ok: true, job: null });
      return;
    }
    job.status = 'running';
    job.workerProfileId = profileId || 'facebook-default';
    job.startedAt = new Date().toISOString();
    job.updatedAt = job.startedAt;
    if (profileId) {
      upsertFacebookProfile({
        profileId,
        extensionVersion: requestUrl.searchParams.get('extensionVersion') || undefined,
        state: 'running',
        currentJobId: job.id,
      });
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const facebookReadyMatch = pathname.match(/^\/api\/social\/facebook\/jobs\/([^/]+)\/ready$/);
  if (req.method === 'POST' && facebookReadyMatch) {
    assertAuthorized(req);
    const job = findFacebookJob(facebookReadyMatch[1]);
    const body = await readJson(req);
    job.status = normalizeFacebookReadyStatus(body.status);
    job.result = { ...(job.result || {}), ...body };
    job.workerProfileId = normalizeProfileId(body.profileId) || job.workerProfileId;
    job.updatedAt = new Date().toISOString();
    if (job.workerProfileId) {
      upsertFacebookProfile({
        profileId: job.workerProfileId,
        extensionVersion: body.extensionVersion,
        state: job.status,
        currentJobId: '',
      });
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const facebookCompleteMatch = pathname.match(/^\/api\/social\/facebook\/jobs\/([^/]+)\/complete$/);
  if (req.method === 'POST' && facebookCompleteMatch) {
    assertAuthorized(req);
    const job = findFacebookJob(facebookCompleteMatch[1]);
    const body = await readJson(req);
    const embeddedPost = body.facebookPostUrl ? createFacebookPostEmbed({ postUrl: body.facebookPostUrl }) : undefined;
    job.status = normalizeFacebookCompleteStatus(body.status || (job.type === 'facebook-comment' ? 'commented' : 'published'));
    job.result = { ...body, embeddedPost };
    job.workerProfileId = normalizeProfileId(body.profileId) || job.workerProfileId;
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    if (job.workerProfileId) {
      upsertFacebookProfile({
        profileId: job.workerProfileId,
        extensionVersion: body.extensionVersion,
        state: 'completed',
        currentJobId: '',
      });
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const facebookRetryMatch = pathname.match(/^\/api\/social\/facebook\/jobs\/([^/]+)\/retry$/);
  if (req.method === 'POST' && facebookRetryMatch) {
    assertAuthorized(req);
    const job = findFacebookJob(facebookRetryMatch[1]);
    const body = await readJson(req).catch(() => ({}));
    job.status = 'queued';
    job.publishMode = normalizePublishMode(body.publishMode || (job.wrapMode && job.publishMode === 'draft' ? 'auto' : job.publishMode));
    delete job.result;
    delete job.workerProfileId;
    delete job.startedAt;
    delete job.completedAt;
    delete job.failedAt;
    job.updatedAt = new Date().toISOString();
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const facebookCancelMatch = pathname.match(/^\/api\/social\/facebook\/jobs\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && facebookCancelMatch) {
    assertAuthorized(req);
    const job = findFacebookJob(facebookCancelMatch[1]);
    if (job.status === 'published' || job.status === 'commented' || job.status === 'completed') {
      throw httpError(409, 'Completed Facebook jobs cannot be cancelled.');
    }
    job.status = 'cancelled';
    job.updatedAt = new Date().toISOString();
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const facebookFailMatch = pathname.match(/^\/api\/social\/facebook\/jobs\/([^/]+)\/fail$/);
  if (req.method === 'POST' && facebookFailMatch) {
    assertAuthorized(req);
    const job = findFacebookJob(facebookFailMatch[1]);
    const body = await readJson(req);
    job.status = String(body.status || 'failed');
    job.error = String(body.error || 'Facebook publisher job failed.');
    job.workerProfileId = normalizeProfileId(body.profileId) || job.workerProfileId;
    job.failedAt = new Date().toISOString();
    job.updatedAt = job.failedAt;
    if (job.workerProfileId) {
      upsertFacebookProfile({
        profileId: job.workerProfileId,
        extensionVersion: body.extensionVersion,
        state: job.status,
        currentJobId: '',
      });
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const facebookJobMatch = pathname.match(/^\/api\/social\/facebook\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && facebookJobMatch) {
    assertAuthorized(req);
    sendJson(res, 200, { ok: true, job: findFacebookJob(facebookJobMatch[1]) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shopee/browser-product-data/latest') {
    assertAuthorized(req);
    sendJson(res, latestBrowserProductData ? 200 : 404, {
      ok: Boolean(latestBrowserProductData),
      productData: latestBrowserProductData,
      error: latestBrowserProductData ? undefined : 'No browser product data has been posted yet.',
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/extension/jobs') {
    assertAuthorized(req);
    const body = await readJson(req);
    const job = createExtensionJobFromBody(body);
    sendJson(res, 202, { ok: true, job });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shopee/extension/profiles') {
    assertAuthorized(req);
    sendJson(res, 200, {
      ok: true,
      profiles: [...extensionProfiles.values()]
        .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt))),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/extension/profiles/heartbeat') {
    assertAuthorized(req);
    const body = await readJson(req);
    const profile = upsertExtensionProfile(body);
    sendJson(res, 200, { ok: true, profile });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/extension/product-info') {
    assertAuthorized(req);
    const body = await readJson(req);
    const input = normalizeProductInfoInput(body);
    const job = createExtensionJob({
      type: 'product-info',
      url: input.url,
      targetProfileId: normalizeProfileId(body.targetProfileId || body.profileId),
    });
    sendJson(res, 202, { ok: true, job });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/extension/product-links') {
    assertAuthorized(req);
    const body = await readJson(req);
    const input = normalizeProductLinksInput(body);
    const job = createExtensionJob({
      type: 'product-links',
      input,
      targetProfileId: normalizeProfileId(body.targetProfileId || body.profileId),
    });
    sendJson(res, 202, { ok: true, job });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/extension/affiliate-links') {
    assertAuthorized(req);
    const body = await readJson(req);
    const input = normalizeInput(body);
    const job = createExtensionJob({
      type: 'affiliate-links',
      input,
      targetProfileId: normalizeProfileId(body.targetProfileId || body.profileId),
    });
    sendJson(res, 202, { ok: true, job });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/extension/affiliate-links/batch') {
    assertAuthorized(req);
    const body = await readJson(req);
    const input = normalizeAffiliateBatchInput(body);
    const jobs = [];
    for (const links of chunk(input.links, MAX_LINKS)) {
      jobs.push(createExtensionJob({
        type: 'affiliate-links',
        input: { links, subIds: input.subIds },
        targetProfileId: normalizeProfileId(body.targetProfileId || body.profileId),
      }));
    }
    sendJson(res, 202, { ok: true, jobs, count: jobs.length });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/extension/product-affiliate') {
    assertAuthorized(req);
    const body = await readJson(req);
    const productInput = normalizeProductInfoInput(body);
    const linkInput = normalizeInput({
      ...body,
      links: [productInput.url],
      link: undefined,
    });
    const job = createExtensionJob({
      type: 'product-affiliate',
      url: productInput.url,
      input: linkInput,
      targetProfileId: normalizeProfileId(body.targetProfileId || body.profileId),
    });
    sendJson(res, 202, { ok: true, job });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shopee/extension/jobs') {
    assertAuthorized(req);
    const limit = Math.min(numberFromQuery(requestUrl.searchParams.get('limit'), 20), 100);
    sendJson(res, 200, {
      ok: true,
      jobs: extensionJobs.slice(-limit).reverse(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shopee/extension/jobs/created') {
    assertAuthorized(req);
    const limit = Math.min(numberFromQuery(requestUrl.searchParams.get('limit'), 100), 500);
    const status = String(requestUrl.searchParams.get('status') || '').trim();
    const jobs = status ? extensionJobs.filter((job) => job.status === status) : extensionJobs;
    sendJson(res, 200, {
      ok: true,
      jobs: jobs.slice(-limit).reverse(),
      total: jobs.length,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shopee/extension/jobs/next') {
    assertAuthorized(req);
    requeueStaleExtensionJobs();
    const profileId = normalizeProfileId(requestUrl.searchParams.get('profileId'));
    if (profileId) {
      upsertExtensionProfile({
        profileId,
        profileName: requestUrl.searchParams.get('profileName') || undefined,
        state: 'polling',
      });
    }
    const job = extensionJobs.find((row) => row.status === 'queued' && jobMatchesProfile(row, profileId));
    if (!job) {
      sendJson(res, 200, { ok: true, job: null });
      return;
    }
    job.status = 'running';
    job.workerProfileId = profileId || 'default';
    job.startedAt = new Date().toISOString();
    job.updatedAt = job.startedAt;
    if (profileId) {
      upsertExtensionProfile({ profileId, state: 'running', currentJobId: job.id });
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const completeMatch = pathname.match(/^\/api\/shopee\/extension\/jobs\/([^/]+)\/complete$/);
  if (req.method === 'POST' && completeMatch) {
    assertAuthorized(req);
    const job = extensionJobs.find((row) => row.id === completeMatch[1]);
    if (!job) {
      throw httpError(404, 'Extension job not found.');
    }
    const body = await readJson(req);
    const payload = body.productData || body.result || body;
    const normalized =
      job.type === 'product-data' || job.type === 'product-info'
        ? normalizeBrowserProductData(payload)
        : normalizeExtensionJobResult(job.type, payload);
    job.status = 'completed';
    job.result = normalized;
    job.workerProfileId = normalizeProfileId(body.profileId) || job.workerProfileId;
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    if (job.workerProfileId) {
      upsertExtensionProfile({ profileId: job.workerProfileId, state: 'completed', currentJobId: '' });
    }
    if (job.type === 'product-data' || job.type === 'product-info') {
      latestBrowserProductData = normalized;
    } else if (job.type === 'product-affiliate' && normalized.productData) {
      latestBrowserProductData = normalized.productData;
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const failMatch = pathname.match(/^\/api\/shopee\/extension\/jobs\/([^/]+)\/fail$/);
  if (req.method === 'POST' && failMatch) {
    assertAuthorized(req);
    const job = extensionJobs.find((row) => row.id === failMatch[1]);
    if (!job) {
      throw httpError(404, 'Extension job not found.');
    }
    const body = await readJson(req);
    job.status = 'failed';
    job.error = String(body.error || 'Extension job failed.');
    job.workerProfileId = normalizeProfileId(body.profileId) || job.workerProfileId;
    job.failedAt = new Date().toISOString();
    job.updatedAt = job.failedAt;
    if (job.workerProfileId) {
      upsertExtensionProfile({ profileId: job.workerProfileId, state: 'error', currentJobId: '' });
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const retryMatch = pathname.match(/^\/api\/shopee\/extension\/jobs\/([^/]+)\/retry$/);
  if (req.method === 'POST' && retryMatch) {
    assertAuthorized(req);
    const job = findExtensionJob(retryMatch[1]);
    resetExtensionJob(job, 'queued');
    sendJson(res, 200, { ok: true, job });
    return;
  }

  const cancelMatch = pathname.match(/^\/api\/shopee\/extension\/jobs\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    assertAuthorized(req);
    const job = findExtensionJob(cancelMatch[1]);
    if (job.status === 'completed') {
      throw httpError(400, 'Completed jobs cannot be cancelled.');
    }
    job.status = 'cancelled';
    job.cancelledAt = new Date().toISOString();
    job.updatedAt = job.cancelledAt;
    sendJson(res, 200, { ok: true, job });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/extension/jobs/clear') {
    assertAuthorized(req);
    const body = await readJson(req);
    const status = body.status ? String(body.status) : '';
    const before = extensionJobs.length;
    extensionJobs = status ? extensionJobs.filter((job) => job.status !== status) : [];
    sendJson(res, 200, { ok: true, removed: before - extensionJobs.length, jobs: extensionJobs });
    return;
  }

  const jobMatch = pathname.match(/^\/api\/shopee\/extension\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && jobMatch) {
    assertAuthorized(req);
    const job = extensionJobs.find((row) => row.id === jobMatch[1]);
    if (!job) {
      throw httpError(404, 'Extension job not found.');
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/product-info/batch') {
    assertAuthorized(req);
    const body = await readJson(req);
    const inputs = normalizeProductInfoBatchInput(body);
    const products = [];
    for (const input of inputs) {
      products.push(await enqueue(() => getProductInfo(input)));
    }
    sendJson(res, 200, { ok: true, products });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shopee/product-affiliate') {
    assertAuthorized(req);
    const body = await readJson(req);
    const productInput = normalizeProductInfoInput(body);
    const linkInput = normalizeInput({
      ...body,
      links: [productInput.url],
      link: undefined,
    });
    const result = await enqueue(async () => {
      const productInfo = await getProductInfo(productInput);
      const productOfferLink = productInfo.affiliateOffer?.available
        ? await createProductOfferAffiliateLink(productInfo.itemId)
        : undefined;
      const affiliateLink = productOfferLink || (await createAffiliateLinks(linkInput));
      return { ...productInfo, affiliateLink };
    });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === 'GET' && pathname === '/debug/page') {
    const activePage = await getShopeePage();
    await activePage.goto('https://affiliate.shopee.vn/offer/custom_link', { waitUntil: 'domcontentloaded' });
    await activePage.waitForTimeout(3000);
    const info = await activePage.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 1000),
      buttons: [...document.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean),
      hasTextarea: !!document.querySelector('textarea'),
      hasLoginText: /login|đăng nhập|sign in/i.test(document.body?.innerText || ''),
    }));
    sendJson(res, 200, info);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
}

async function login() {
  await mkdir(USER_DATA_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: BROWSER_CHANNEL,
    headless: false,
    viewport: { width: 1365, height: 900 },
  });
  const loginPage = context.pages()[0] || (await context.newPage());
  await loginPage.goto(CUSTOM_LINK_URL, { waitUntil: 'domcontentloaded' });
  console.log('Chrome is open. Log in to Shopee Affiliate, then press Ctrl+C here when done.');
  await new Promise(() => {});
}

function createExtensionJob(fields) {
  const now = new Date().toISOString();
  const job = {
    id: String(++extensionJobCounter),
    status: 'queued',
    type: fields.type || 'product-data',
    url: fields.url,
    input: fields.input,
    targetProfileId: normalizeProfileId(fields.targetProfileId || fields.profileId),
    createdAt: now,
    updatedAt: now,
  };
  extensionJobs.push(job);
  return job;
}

function createExtensionJobFromBody(body) {
  const type = String(body.type || 'product-data');
  const targetProfileId = normalizeProfileId(body.targetProfileId || body.profileId);
  if (type === 'product-data' || type === 'product-info') {
    const input = normalizeProductInfoInput(body);
    return createExtensionJob({ type, url: input.url, targetProfileId });
  }
  if (type === 'product-affiliate') {
    const productInput = normalizeProductInfoInput(body);
    const linkInput = normalizeInput({
      ...body,
      links: [productInput.url],
      link: undefined,
    });
    return createExtensionJob({ type, url: productInput.url, input: linkInput, targetProfileId });
  }
  if (type === 'affiliate-links') {
    return createExtensionJob({ type, input: normalizeInput(body), targetProfileId });
  }
  if (type === 'product-links') {
    return createExtensionJob({ type, input: normalizeProductLinksInput(body), targetProfileId });
  }
  throw httpError(400, `Unsupported extension job type: ${type}`);
}

function upsertExtensionProfile(body) {
  const profileId = normalizeProfileId(body.profileId || body.id);
  if (!profileId) {
    throw httpError(400, '`profileId` is required.');
  }

  const previous = extensionProfiles.get(profileId) || {};
  const now = new Date().toISOString();
  const profile = {
    ...previous,
    id: profileId,
    profileId,
    profileName: normalizeText(body.profileName || body.name) || previous.profileName || profileId,
    apiBase: normalizeText(body.apiBase) || previous.apiBase,
    extensionVersion: normalizeText(body.extensionVersion) || previous.extensionVersion,
    userAgent: normalizeText(body.userAgent) || previous.userAgent,
    state: normalizeText(body.state) || previous.state || 'online',
    extensionVersion: normalizeText(body.extensionVersion) || previous.extensionVersion || '',
    currentJobId: normalizeText(body.currentJobId) || '',
    firstSeenAt: previous.firstSeenAt || now,
    lastSeenAt: now,
  };
  extensionProfiles.set(profileId, profile);
  return profile;
}

function jobMatchesProfile(job, profileId) {
  const targetProfileId = normalizeProfileId(job.targetProfileId);
  if (!targetProfileId) return true;
  return Boolean(profileId) && targetProfileId === profileId;
}

function requeueStaleExtensionJobs() {
  const now = Date.now();
  for (const job of extensionJobs) {
    if (job.status !== 'running') continue;
    const startedAt = Date.parse(job.startedAt || job.updatedAt || '');
    if (!Number.isFinite(startedAt) || now - startedAt < EXTENSION_JOB_TIMEOUT_MS) continue;
    job.status = 'queued';
    job.error = `Requeued after ${Math.round(EXTENSION_JOB_TIMEOUT_MS / 1000)}s without completion.`;
    job.workerProfileId = '';
    job.startedAt = undefined;
    job.updatedAt = new Date().toISOString();
  }
}

function normalizeProfileId(value) {
  const text = String(value || '').trim();
  if (!text || text === 'any' || text === '*') return '';
  return text.replace(/[^\w.-]+/g, '-').slice(0, 80);
}

function findExtensionJob(id) {
  const job = extensionJobs.find((row) => row.id === id);
  if (!job) {
    throw httpError(404, 'Extension job not found.');
  }
  return job;
}

function resetExtensionJob(job, status) {
  job.status = status;
  job.updatedAt = new Date().toISOString();
  delete job.startedAt;
  delete job.completedAt;
  delete job.failedAt;
  delete job.cancelledAt;
  delete job.error;
  delete job.result;
}

async function createAffiliateLinks(input) {
  const activePage = await getShopeePage();
  await ensureCustomLinkPage(activePage);

  const graphQlResult = await tryGraphQl(activePage, input);
  if (graphQlResult.ok) {
    return {
      strategy: 'graphql',
      links: graphQlResult.links,
    };
  }

  const uiLinks = await convertViaUi(activePage, input);
  return {
    strategy: 'ui',
    links: uiLinks,
  };
}

async function getProductInfo(input) {
  const ids = await resolveProductIds(input.url);
  const product = await getShopeeProduct(ids);
  const affiliateOffer = await getAffiliateProductOffer(ids.itemId);

  return {
    inputUrl: input.url,
    resolvedUrl: ids.url,
    shopId: ids.shopId,
    itemId: ids.itemId,
    product,
    affiliateOffer,
  };
}

async function getProductData(input) {
  const ids = await resolveProductIds(input.url);
  const product = await getShopeeProduct(ids);
  const reviews = await getShopeeProductReviews(ids);

  return {
    inputUrl: input.url,
    resolvedUrl: ids.url,
    shopId: ids.shopId,
    itemId: ids.itemId,
    product: withoutRaw(product),
    reviews,
  };
}

async function getProductId(input, options = {}) {
  const direct = extractProductIds(input.url);
  if (direct) {
    return formatProductIdResult(input.url, direct, input.url, false);
  }

  if (!options.resolve) {
    throw httpError(
      400,
      'Cannot detect Shopee shop_id/item_id from this URL. Retry with `resolve: true` for short or redirected links.',
    );
  }

  const resolved = await resolveProductIds(input.url);
  return formatProductIdResult(input.url, resolved, resolved.url, true);
}

function formatProductIdResult(inputUrl, ids, resolvedUrl, resolved) {
  return {
    inputUrl,
    url: resolvedUrl || inputUrl,
    shopId: String(ids.shopId),
    itemId: String(ids.itemId),
    productKey: `${ids.shopId}.${ids.itemId}`,
    canonicalUrl: `https://shopee.vn/product/${ids.shopId}/${ids.itemId}`,
    resolved: Boolean(resolved),
  };
}

function createFacebookPostEmbed(body) {
  const postUrl = String(body.postUrl || body.url || '').trim();
  if (!postUrl) {
    throw httpError(400, '`postUrl` or `url` is required.');
  }

  const parsed = safeUrl(postUrl);
  if (!parsed || !/(^|\.)facebook\.com$/i.test(parsed.hostname)) {
    throw httpError(400, '`postUrl` must be a facebook.com post URL.');
  }

  const width = Math.min(Math.max(numberFromQuery(body.width, 500), 320), 750);
  const showText = body.showText === undefined ? true : Boolean(body.showText);
  const embedUrl = new URL('https://www.facebook.com/plugins/post.php');
  embedUrl.searchParams.set('href', postUrl);
  embedUrl.searchParams.set('show_text', showText ? 'true' : 'false');
  embedUrl.searchParams.set('width', String(width));

  return {
    postUrl,
    embedUrl: embedUrl.toString(),
    embedHtml: `<iframe src="${escapeAttribute(embedUrl.toString())}" width="${width}" height="640" style="border:none;overflow:hidden" scrolling="no" frameborder="0" allowfullscreen="true" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"></iframe>`,
  };
}

function createAiDiagnosticReport(body) {
  const report = {
    id: `diag-${aiDiagnostics.length + 1}`,
    source: String(body.source || 'extension').slice(0, 80),
    profileId: normalizeProfileId(body.profileId) || '',
    extensionVersion: String(body.extensionVersion || '').slice(0, 40),
    createdAt: new Date().toISOString(),
    symptoms: Array.isArray(body.symptoms) ? body.symptoms.slice(0, 30).map(String) : [],
    checks: body.checks && typeof body.checks === 'object' ? body.checks : {},
    fixes: Array.isArray(body.fixes) ? body.fixes.slice(0, 30).map(String) : [],
  };
  report.analysis = analyzeAiDiagnosticReport(report);
  aiDiagnostics.push(report);
  if (aiDiagnostics.length > 200) aiDiagnostics = aiDiagnostics.slice(-200);
  return report;
}

function analyzeAiDiagnosticReport(report) {
  const checks = report.checks || {};
  const shopeeTabs = Array.isArray(checks.shopeeTabs) ? checks.shopeeTabs : [];
  const failedTabs = shopeeTabs.filter((tab) => tab.ok === false || tab.injected === false);
  const tabsWithoutPanel = shopeeTabs.filter((tab) => tab.ok && tab.panelExists === false);
  const tabsWithoutTools = shopeeTabs.filter((tab) =>
    tab.ok && tab.isProductPage && Number(tab.detailToolButtons || 0) === 0 && Number(tab.cardToolbars || 0) === 0,
  );
  const issues = [];
  const actions = [];

  if (checks.serverOk === false) {
    issues.push('Server API không phản hồi từ extension.');
    actions.push('Kiểm tra API base/token trong Settings và khởi động lại server.');
  }
  if (report.symptoms.includes('fb_wrap_failed')) {
    issues.push(`FB Wrap failed${checks.fbWrapError ? `: ${checks.fbWrapError}` : '.'}`);
    actions.push('Mở shopeeAI Manager, kiểm tra Facebook target URL, affiliate session, rồi bấm lại FB Wrap.');
  }
  if (report.symptoms.includes('fb_wrap_failed') && checks.facebookTargetUrlConfigured === false) {
    issues.push('Chưa cấu hình Default Facebook target URL cho FB Wrap.');
    actions.push('Vào Settings, điền Default Facebook target URL dạng https://www.facebook.com/<profile-or-page>, sau đó Save settings.');
  }
  if (report.symptoms.includes('fb_wrap_failed') && checks.affiliateLinkAvailable === false) {
    issues.push('FB Wrap chưa có affiliate link để đăng Facebook.');
    actions.push('Kiểm tra tab Shopee Affiliate đã đăng nhập, sau đó thử nút Aff trước khi bấm FB Wrap.');
  }
  if (!report.extensionVersion) {
    issues.push('Extension chưa gửi được version trong diagnostic.');
    actions.push('Reload extension shopeeAI trong chrome://extensions.');
  }
  if (!shopeeTabs.length) {
    issues.push('Không tìm thấy tab shopee.vn đang mở.');
    actions.push('Mở một trang sản phẩm Shopee rồi chạy AI fix lại.');
  }
  if (failedTabs.length) {
    issues.push(`${failedTabs.length} tab Shopee chưa nhận content script.`);
    actions.push('Auto-fix sẽ inject lại content.js vào các tab Shopee đang mở.');
  }
  if (tabsWithoutPanel.length) {
    issues.push(`${tabsWithoutPanel.length} tab Shopee chưa có panel shopeeAI.`);
    actions.push('Auto-fix sẽ reset panel và khởi tạo lại UI.');
  }
  if (tabsWithoutTools.length) {
    issues.push(`${tabsWithoutTools.length} tab sản phẩm chưa có toolbar/button sản phẩm.`);
    actions.push('Auto-fix sẽ reset toolbar và gắn lại bằng fallback floating nếu Shopee đổi DOM.');
  }
  if (checks.facebookPublisherVersion && !/^0\.1\.(6|[7-9]|\d{2,})$/.test(String(checks.facebookPublisherVersion))) {
    issues.push('Facebook Publisher extension có vẻ đang là bản cũ.');
    actions.push('Reload shopeeAI Facebook Publisher để chạy flow wrap/publish mới.');
  }
  if (!issues.length) {
    issues.push('Không thấy lỗi cấu hình rõ ràng trong report mới nhất.');
    actions.push('Nếu UI vẫn không hiện, reload tab Shopee và chạy AI fix lại để lấy report mới.');
  }

  return {
    status: issues.some((issue) => /không|chưa|cũ|lỗi/i.test(issue)) ? 'needs_attention' : 'ok',
    issues,
    actions,
  };
}

function createFacebookJobFromBody(body) {
  const now = new Date().toISOString();
  const type = normalizeFacebookJobType(body.type);
  const targetPostUrls = normalizeFacebookUrlList(body.targetPostUrls || body.postUrls || body.posts);
  const commentMode = normalizeFacebookCommentMode(body.commentMode || body.selectionMode || body.mode);
  const selectedCommentUrl = type === 'facebook-comment'
    ? selectFacebookCommentTargetUrl(body.targetPostUrl || body.postUrl || body.targetUrl, targetPostUrls, commentMode)
    : '';
  const targetUrl = normalizeFacebookTargetUrl(
    selectedCommentUrl || body.targetUrl || process.env.FACEBOOK_DEFAULT_TARGET_URL,
  );
  const affiliateLink = String(body.affiliateLink || body.link || '').trim();
  const caption = normalizePostText(body.caption || body.commentText || body.comment);
  if (!targetUrl) throw httpError(400, '`targetUrl` is required.');
  if (type !== 'facebook-comment' && !affiliateLink) throw httpError(400, '`affiliateLink` is required.');
  if (!caption) throw httpError(400, type === 'facebook-comment' ? '`commentText` is required.' : '`caption` is required.');

  const publishMode = normalizePublishMode(body.publishMode || process.env.FACEBOOK_PUBLISH_MODE || 'draft');
  const schedule = normalizeFacebookSchedule(body.schedule || body);
  const job = {
    id: `fb-${++facebookJobCounter}`,
    type,
    status: 'queued',
    targetUrl,
    affiliateLink,
    caption,
    commentText: type === 'facebook-comment' ? caption : '',
    targetPostUrls,
    commentMode: type === 'facebook-comment' ? commentMode : '',
    wrapMode: Boolean(body.wrapMode || body.facebookWrap || body.copyFacebookWrappedLink),
    media: Array.isArray(body.media) ? body.media.map(String).filter(Boolean) : [],
    productKey: normalizeText(body.productKey),
    publishMode,
    schedule,
    targetProfileId: normalizeProfileId(body.targetProfileId || body.profileId),
    createdAt: now,
    updatedAt: now,
  };
  facebookJobs.push(job);
  return job;
}

function normalizeFacebookJobType(value) {
  const type = String(value || 'facebook-publish-post').trim().toLowerCase();
  return ['facebook-publish-post', 'facebook-comment'].includes(type) ? type : 'facebook-publish-post';
}

function normalizeFacebookUrlList(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/\s+/);
  return rows.map(normalizeFacebookTargetUrl).filter(Boolean);
}

function normalizeFacebookCommentMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['random', 'first', 'specific'].includes(mode) ? mode : 'specific';
}

function selectFacebookCommentTargetUrl(explicitUrl, urls, mode) {
  const explicit = normalizeFacebookTargetUrl(explicitUrl);
  if (explicit) return explicit;
  if (!urls.length) throw httpError(400, '`targetPostUrl` or `targetPostUrls` is required for facebook-comment.');
  if (mode === 'random') return urls[Math.floor(Math.random() * urls.length)];
  return urls[0];
}

function normalizeFacebookTargetUrl(value) {
  const url = String(value || '').trim();
  const parsed = safeUrl(url);
  if (!parsed || !/(^|\.)facebook\.com$/i.test(parsed.hostname)) return '';
  return parsed.toString();
}

function normalizePostText(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

function normalizePublishMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['manual', 'draft', 'confirm', 'auto'].includes(mode) ? mode : 'draft';
}

function normalizeFacebookReadyStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return ['ready_for_publish', 'published_pending_url'].includes(status) ? status : 'ready_for_publish';
}

function normalizeFacebookCompleteStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return ['published', 'commented', 'completed'].includes(status) ? status : 'published';
}

function normalizeFacebookSchedule(value = {}) {
  const cooldownMinutes = Math.min(numberFromQuery(value.cooldownMinutes, numberFromEnv('FACEBOOK_MIN_COOLDOWN_MINUTES', 45)), 1440);
  const jitterMinutes = Math.min(numberFromQuery(value.jitterMinutes, numberFromEnv('FACEBOOK_JITTER_MINUTES', 10)), 240);
  return {
    notBefore: normalizeText(value.notBefore),
    cooldownMinutes,
    jitterMinutes,
    maxPostsPerDay: Math.min(numberFromQuery(value.maxPostsPerDay, numberFromEnv('FACEBOOK_MAX_POSTS_PER_DAY', 12)), 100),
  };
}

function facebookJobMatchesProfile(job, profileId) {
  return !job.targetProfileId || !profileId || job.targetProfileId === profileId;
}

function facebookJobIsSchedulable(job, now) {
  const notBefore = Date.parse(job.schedule?.notBefore || '');
  if (Number.isFinite(notBefore) && now < notBefore) return false;

  const cooldownMs = (job.schedule?.cooldownMinutes || 0) * 60 * 1000;
  if (!cooldownMs) return true;

  const latestPublished = facebookJobs
    .filter((row) => row.status === 'published' && row.targetUrl === job.targetUrl && row.completedAt)
    .map((row) => Date.parse(row.completedAt))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return !latestPublished || now - latestPublished >= cooldownMs;
}

function findFacebookJob(id) {
  const job = facebookJobs.find((row) => row.id === id);
  if (!job) throw httpError(404, 'Facebook job not found.');
  return job;
}

function upsertFacebookProfile(body) {
  const profileId = normalizeProfileId(body.profileId || body.id);
  if (!profileId) throw httpError(400, '`profileId` is required.');
  const previous = facebookProfiles.get(profileId) || {};
  const now = new Date().toISOString();
  const profile = {
    ...previous,
    id: profileId,
    profileId,
    profileName: normalizeText(body.profileName || body.name) || previous.profileName || profileId,
    state: normalizeText(body.state) || previous.state || 'online',
    currentJobId: normalizeText(body.currentJobId) || '',
    firstSeenAt: previous.firstSeenAt || now,
    lastSeenAt: now,
  };
  facebookProfiles.set(profileId, profile);
  return profile;
}

function extractShopeeLinksFromFacebookPayload(body) {
  const candidates = [
    body.text,
    body.html,
    body.href,
    body.url,
    ...(Array.isArray(body.hrefs) ? body.hrefs : []),
    ...(Array.isArray(body.links) ? body.links : []),
  ]
    .flatMap((value) => String(value || '').split(/\s+/))
    .map((value) => value.trim())
    .filter(Boolean);

  const matches = [];
  for (const candidate of candidates) {
    for (const link of extractUrls(candidate)) {
      const normalized = normalizeFacebookShopeeLink(link);
      if (normalized) matches.push(normalized);
    }
  }

  return dedupeBy(matches, (row) => row.cleanShopeeLink || row.shopeeLink);
}

function extractUrls(text) {
  const urls = [];
  const pattern = /https?:\/\/[^\s"'<>]+/gi;
  for (const match of String(text || '').matchAll(pattern)) {
    urls.push(match[0].replace(/[),.;]+$/g, ''));
  }
  return urls;
}

function normalizeFacebookShopeeLink(rawUrl) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return undefined;

  let source = 'direct';
  let shopeeLink = rawUrl;
  if (/^l\.facebook\.com$/i.test(parsed.hostname) && parsed.pathname === '/l.php') {
    const target = parsed.searchParams.get('u');
    if (!target) return undefined;
    shopeeLink = target;
    source = 'facebook_redirect';
  }

  const targetUrl = safeUrl(shopeeLink);
  if (!targetUrl || !/(^|\.)shopee\.vn$/i.test(targetUrl.hostname)) return undefined;
  const cleanUrl = new URL(targetUrl.toString());
  for (const key of [...cleanUrl.searchParams.keys()]) {
    if (/^(content_source|fb_content_id|encrypted_payload|channel_type|content_type|fbclid)$/i.test(key)) {
      cleanUrl.searchParams.delete(key);
    }
  }

  return {
    source,
    shopeeLink: targetUrl.toString(),
    cleanShopeeLink: cleanUrl.toString(),
    channelType: targetUrl.searchParams.get('channel_type') || undefined,
    contentSource: targetUrl.searchParams.get('content_source') || undefined,
    contentType: targetUrl.searchParams.get('content_type') || undefined,
    facebookContentId: targetUrl.searchParams.get('fb_content_id') || undefined,
  };
}

function safeUrl(value) {
  try {
    return new URL(String(value || ''));
  } catch {
    return undefined;
  }
}

async function getShopeePage() {
  if (!browserContext) {
    await mkdir(USER_DATA_DIR, { recursive: true });
    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
      channel: BROWSER_CHANNEL,
      headless: HEADLESS,
      viewport: { width: 1365, height: 900 },
    });
  }

  if (!page || page.isClosed()) {
    page = browserContext.pages()[0] || (await browserContext.newPage());
  }

  return page;
}

async function getShopPage() {
  if (!browserContext) {
    await getShopeePage();
  }

  if (!shopPage || shopPage.isClosed()) {
    shopPage = await browserContext.newPage();
  }

  return shopPage;
}

async function ensureCustomLinkPage(activePage) {
  if (!activePage.url().startsWith('https://affiliate.shopee.vn/offer/custom_link')) {
    await activePage.goto(CUSTOM_LINK_URL, { waitUntil: 'domcontentloaded' });
  }

  await ensureAffiliateSession(activePage);
}

async function ensureAffiliateSession(activePage) {
  await activePage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

  const loginVisible = await activePage
    .getByText(/login|đăng nhập|sign in/i)
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);

  if (loginVisible) {
    throw httpError(
      401,
      'Shopee session is not logged in. Run `npm run login`, log in, then restart the server.',
    );
  }
}

async function resolveProductIds(url) {
  const direct = extractProductIds(url);
  if (direct) return { ...direct, url };

  const activeShopPage = await getShopPage();
  await activeShopPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await activeShopPage.waitForTimeout(1200);

  const resolvedUrl = activeShopPage.url();
  const resolved = extractProductIds(resolvedUrl);
  if (resolved) return { ...resolved, url: resolvedUrl };

  throw httpError(400, 'Cannot detect Shopee shop_id/item_id from this URL.');
}

function extractProductIds(url) {
  const text = String(url || '');
  const itemFirstMatch = text.match(/[?&]item_id=(\d+).*?[?&]shop_id=(\d+)/i);
  if (itemFirstMatch) {
    return { itemId: itemFirstMatch[1], shopId: itemFirstMatch[2] };
  }

  const patterns = [
    /(?:^|[/?&.-])i\.(\d+)\.(\d+)(?:[/?&#]|$)/i,
    /\/product\/(\d+)\/(\d+)(?:[/?&#]|$)/i,
    /[?&]shop_id=(\d+).*?[?&]item_id=(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { shopId: match[1], itemId: match[2] };
  }

  return null;
}

async function getShopeeProduct(ids) {
  const activeShopPage = await getShopPage();
  await ensureShopeeProductContext(activeShopPage, ids.url);

  const response = await activeShopPage.evaluate(async ({ shopId, itemId }) => {
    const url = `/api/v4/pdp/get_pc?shop_id=${encodeURIComponent(shopId)}&item_id=${encodeURIComponent(
      itemId,
    )}&detail_level=0`;
    const result = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });

    return {
      status: result.status,
      body: await result.json().catch(() => null),
    };
  }, ids);

  if (response.status >= 400 || !response.body?.data) {
    const fallback = await scrapeShopeeProductDom(activeShopPage);
    if (fallback.available) {
      return {
        ...fallback,
        status: response.status,
        raw: response.body,
      };
    }

    return {
      available: false,
      status: response.status,
      raw: response.body,
    };
  }

  const data = response.body.data;
  const item = data.item || {};
  const priceInfo = item.price_info || {};
  const price = firstNumber(priceInfo.price, item.price, item.price_min);
  const priceBeforeDiscount = firstNumber(
    priceInfo.price_before_discount,
    item.price_before_discount,
    item.price_before_discount_min,
  );
  const normalizedPrice = normalizeShopeePrice(price);
  const normalizedPriceBeforeDiscount = normalizeShopeePrice(priceBeforeDiscount);
  const sold = firstNumber(item.historical_sold, item.sold);
  const ratingCount = normalizeRatingCount(item.item_rating?.rating_count);
  const images = normalizeShopeeImages(item.images || (item.image ? [item.image] : []));
  const videos = normalizeShopeeVideos(item.video_info_list || item.video_info || item.videos);

  return {
    available: true,
    name: item.title || item.name,
    description: item.description,
    image: images[0],
    images,
    videos,
    currency: data.currency || 'VND',
    price: normalizedPrice,
    salePrice: normalizedPrice,
    priceBeforeDiscount: normalizedPriceBeforeDiscount,
    discount: priceInfo.discount || item.raw_discount,
    stock: firstNumber(item.stock, item.normal_stock),
    sold,
    revenue: estimateRevenue(normalizedPrice, sold),
    rating: item.item_rating?.rating_star,
    totalReviews: firstNumber(item.cmt_count, ratingCount?.total),
    ratingCount,
    shop: data.shop
      ? {
          id: data.shop.shopid || data.shop.shop_id,
          name: data.shop.name || data.shop.shop_name,
          username: data.shop.account?.username || data.shop.username,
          rating: data.shop.rating_star,
          followers: firstNumber(data.shop.follower_count, data.shop.followers),
          responseRate: data.shop.response_rate,
          location: data.shop.shop_location,
        }
      : undefined,
    raw: data,
  };
}

async function getShopeeProductReviews(ids) {
  const activeShopPage = await getShopPage();
  await ensureShopeeProductContext(activeShopPage, ids.url);

  const response = await activeShopPage.evaluate(async ({ shopId, itemId }) => {
    const params = new URLSearchParams({
      shopid: shopId,
      itemid: itemId,
      offset: '0',
      limit: '20',
      filter: '0',
      flag: '1',
      type: '0',
    });
    const result = await fetch(`/api/v2/item/get_ratings?${params.toString()}`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });

    return {
      status: result.status,
      body: await result.json().catch(() => null),
    };
  }, ids);

  if (response.status >= 400 || !response.body?.data) {
    const fallback = await scrapeShopeeReviewsDom(activeShopPage);
    if (fallback.available) {
      return {
        ...fallback,
        status: response.status,
        raw: response.body,
      };
    }

    return {
      available: false,
      status: response.status,
      raw: response.body,
    };
  }

  const ratings = Array.isArray(response.body.data.ratings) ? response.body.data.ratings : [];
  const items = ratings.map((rating) => ({
    rating: rating.rating_star,
    comment: normalizeText(rating.comment),
    author: rating.author_username,
    createdAt: rating.ctime ? new Date(rating.ctime * 1000).toISOString() : undefined,
    images: normalizeShopeeImages(rating.images || []),
    videos: normalizeShopeeVideos(rating.videos || rating.video_info_list || []),
  }));

  return {
    available: true,
    total: firstNumber(response.body.data.item_rating_summary?.rating_total, response.body.data.count),
    summary: summarizeReviews(items),
    items,
    raw: response.body.data,
  };
}

async function ensureShopeeProductContext(activeShopPage, url) {
  if (!activeShopPage.url().startsWith('https://shopee.vn')) {
    await activeShopPage.goto(SHOPEE_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }

  if (url && activeShopPage.url() !== url) {
    await activeShopPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await activeShopPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
}

async function scrapeShopeeProductDom(activeShopPage) {
  await activeShopPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await activeShopPage.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await activeShopPage.waitForTimeout(800);

  const data = await activeShopPage.evaluate(() => {
    const text = document.body?.innerText || '';
    const name = document.querySelector('h1')?.textContent?.trim();
    const imageUrls = [...document.querySelectorAll('img')]
      .map((img) => img.currentSrc || img.src)
      .filter((src) => /shopee|susercontent/i.test(src || ''));
    const priceTexts = [...text.matchAll(/(?:₫\s*)?(\d{1,3}(?:[.,]\d{3})+)\s*₫/g)].map((match) => match[0]);
    const ratingMatch = text.match(/(^|\n)\s*(\d(?:[.,]\d)?)\s*(?=\n)/);
    const ratingsMatch = text.match(/([\d.,]+k?)\s+ratings/i);
    const soldMatch = text.match(/([\d.,]+k?\+?)\s+Sold/i);
    const discountMatch = text.match(/-\d+%/);
    const favoriteMatch = text.match(/Favorite\s*\(([^)]+)\)/i);
    const hasVideo = /icon video play|video/i.test(text);

    return {
      name,
      title: document.title,
      text,
      imageUrls,
      priceTexts,
      ratingText: ratingMatch?.[2],
      ratingsText: ratingsMatch?.[1],
      soldText: soldMatch?.[1],
      discountText: discountMatch?.[0],
      favoriteText: favoriteMatch?.[1],
      hasVideo,
    };
  });

  const priceValues = data.priceTexts.map(parseVietnamDong).filter(Number.isFinite);
  const salePrice = priceValues.length ? Math.min(...priceValues) : undefined;
  const priceBeforeDiscount = priceValues.length > 1 ? Math.max(...priceValues) : undefined;
  const sold = parseCompactNumber(data.soldText);
  const totalReviews = parseCompactNumber(data.ratingsText);

  return {
    available: Boolean(data.name),
    strategy: 'dom_fallback',
    name: data.name,
    description: extractDescription(data.text),
    image: data.imageUrls[0],
    images: [...new Set(data.imageUrls)],
    videos: data.hasVideo ? [{ available: true }] : [],
    currency: 'VND',
    price: salePrice,
    salePrice,
    priceBeforeDiscount,
    discount: data.discountText,
    sold,
    revenue: estimateRevenue(salePrice, sold),
    rating: parseLocaleNumber(data.ratingText),
    totalReviews,
    favoriteCount: parseCompactNumber(data.favoriteText),
    shop: extractShopFromText(data.text),
  };
}

async function scrapeShopeeReviewsDom(activeShopPage) {
  await activeShopPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await activeShopPage.waitForTimeout(1200);

  const data = await activeShopPage.evaluate(() => {
    const text = document.body?.innerText || '';
    const totalMatch = text.match(/Product Ratings\s*\n\s*([\d.,]+)\s+out of 5/i);
    const snippets = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 25 && line.length <= 350)
      .filter((line) => !/add to cart|buy now|shipping|voucher|sold|ratings/i.test(line))
      .slice(0, 5);

    return {
      text,
      averageRatingText: totalMatch?.[1],
      snippets,
    };
  });

  return {
    available: Boolean(data.averageRatingText || data.snippets.length),
    strategy: 'dom_fallback',
    summary: {
      count: data.snippets.length,
      averageRating: parseLocaleNumber(data.averageRatingText),
      snippets: data.snippets,
    },
    items: data.snippets.map((comment) => ({ comment })),
  };
}

async function getAffiliateProductOffer(itemId) {
  const activePage = await getShopeePage();
  if (!activePage.url().startsWith('https://affiliate.shopee.vn')) {
    await activePage.goto(CUSTOM_LINK_URL, { waitUntil: 'domcontentloaded' });
  }
  await ensureAffiliateSession(activePage);

  const response = await activePage.evaluate(async ({ itemId }) => {
    const result = await fetch(`/api/v3/offer/product?item_id=${encodeURIComponent(itemId)}`, {
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'Affiliate-Program-Type': '1',
      },
    });

    return {
      status: result.status,
      body: await result.json().catch(() => null),
    };
  }, { itemId });

  if (response.status >= 400 || response.body?.code !== 0 || !response.body?.data) {
    return {
      available: false,
      status: response.status,
      raw: response.body,
    };
  }

  return {
    available: true,
    ...extractAffiliateOfferFields(response.body.data),
    raw: response.body.data,
  };
}

async function createProductOfferAffiliateLink(itemId) {
  const activePage = await getShopeePage();
  await activePage.goto(`https://affiliate.shopee.vn/offer/product_offer/${encodeURIComponent(itemId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await ensureAffiliateSession(activePage);

  await closeResultModal(activePage);
  await activePage.getByRole('button', { name: /Lấy link|Get Link/i }).click({ timeout: 15000 });

  const resultBox = activePage.locator('.ant-modal textarea, [role="dialog"] textarea').first();
  await resultBox.waitFor({ state: 'visible', timeout: 30000 });
  const shortLink = (await resultBox.inputValue()).trim();
  if (!shortLink) {
    throw httpError(502, 'Shopee did not return a product offer affiliate link.');
  }

  return {
    strategy: 'product_offer_ui',
    links: [
      {
        itemId,
        shortLink,
      },
    ],
  };
}

async function closeResultModal(activePage) {
  const closeButton = activePage.getByRole('button', { name: /close/i }).last();
  if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeButton.click().catch(() => {});
  }
}

function extractAffiliateOfferFields(data) {
  return {
    offerId: data.offer_id,
    commissionId: data.commission_id,
    commissionRate: firstDefined(
      data.commission_rate,
      data.max_commission_rate,
      data.seller_commission_rate,
      data.default_commission_rate,
    ),
    commission: firstDefined(data.commission, data.max_commission, data.estimated_commission),
    status: firstDefined(data.offer_status, data.status),
    productName: firstDefined(data.item_name, data.product_name, data.name),
    price: normalizeShopeePrice(firstNumber(data.price, data.price_min)),
    priceBeforeDiscount: normalizeShopeePrice(
      firstNumber(data.price_before_discount, data.price_before_discount_min),
    ),
    shopId: firstDefined(data.shop_id, data.shopid),
    shopName: firstDefined(data.shop_name, data.shopName),
  };
}

async function tryGraphQl(activePage, input) {
  try {
    const response = await activePage.evaluate(async ({ links, subIds }) => {
      const advancedLinkParams = {
        subId1: subIds[0] || undefined,
        subId2: subIds[1] || undefined,
        subId3: subIds[2] || undefined,
        subId4: subIds[3] || undefined,
        subId5: subIds[4] || undefined,
      };

      const payload = {
        operationName: 'batchGetCustomLink',
        query: `
          query batchGetCustomLink($linkParams: [CustomLinkParam!], $sourceCaller: SourceCaller) {
            batchCustomLink(linkParams: $linkParams, sourceCaller: $sourceCaller) {
              shortLink
              longLink
              failCode
            }
          }
        `,
        variables: {
          linkParams: links.map((originalLink) => ({ originalLink, advancedLinkParams })),
          sourceCaller: 'CUSTOM_LINK_CALLER',
        },
      };

      const result = await fetch('/api/v3/gql?q=batchCustomLink', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'Affiliate-Program-Type': '1',
        },
        body: JSON.stringify(payload),
      });

      return {
        status: result.status,
        body: await result.json().catch(() => null),
      };
    }, input);

    const rows = response.body?.data?.batchCustomLink;
    if (!response.status || response.status >= 400 || !Array.isArray(rows)) {
      return { ok: false };
    }

    return {
      ok: rows.every((row) => !row.failCode),
      links: rows.map((row, index) => ({
        originalLink: input.links[index],
        shortLink: row.shortLink,
        longLink: row.longLink,
        failCode: row.failCode || 0,
      })),
    };
  } catch {
    return { ok: false };
  }
}

async function convertViaUi(activePage, input) {
  await closeResultModal(activePage);

  const textarea = activePage.locator('textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 15000 });
  await textarea.fill(input.links.join('\n'));

  const textboxes = activePage.locator('.custom-input input');
  for (let index = 0; index < input.subIds.length; index += 1) {
    const subId = input.subIds[index];
    if (subId) {
      await textboxes.nth(index).fill(subId);
    }
  }

  const allButtons = await activePage.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean),
  );
  console.log('[DEBUG] Buttons on page:', JSON.stringify(allButtons));

  await activePage.getByRole('button', { name: /Lấy link|Get Link/i }).click();

  const resultBox = activePage.locator('.ant-modal textarea, [role="dialog"] textarea').first();
  await resultBox.waitFor({ state: 'visible', timeout: 30000 });
  const value = await resultBox.inputValue();
  const shortLinks = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (shortLinks.length !== input.links.length) {
    throw httpError(502, `Shopee returned ${shortLinks.length} links for ${input.links.length} inputs.`);
  }

  return shortLinks.map((shortLink, index) => ({
    originalLink: input.links[index],
    shortLink,
  }));
}

function normalizeInput(body) {
  const rawLinks = Array.isArray(body.links) ? body.links : body.link ? [body.link] : [];
  const links = rawLinks.map((link) => String(link || '').trim()).filter(Boolean);

  if (links.length === 0) {
    throw httpError(400, '`link` or `links` is required.');
  }
  if (links.length > MAX_LINKS) {
    throw httpError(400, `Shopee Custom Link supports up to ${MAX_LINKS} links per request.`);
  }

  const subIds = SUB_ID_KEYS.map((key, index) => {
    const value = body[key] ?? body.subIds?.[index] ?? '';
    return String(value || '').trim();
  });

  for (const subId of subIds) {
    if (subId && !/^[a-zA-Z0-9]{1,50}$/.test(subId)) {
      throw httpError(400, 'Sub IDs must be alphanumeric and up to 50 characters.');
    }
  }

  return { links, subIds };
}

function normalizeAffiliateBatchInput(body) {
  const rawLinks = Array.isArray(body.links) ? body.links : body.link ? [body.link] : [];
  const links = rawLinks.map((link) => String(link || '').trim()).filter(Boolean);

  if (links.length === 0) {
    throw httpError(400, '`link` or `links` is required.');
  }

  const subIds = SUB_ID_KEYS.map((key, index) => {
    const value = body[key] ?? body.subIds?.[index] ?? '';
    return String(value || '').trim();
  });

  for (const subId of subIds) {
    if (subId && !/^[a-zA-Z0-9]{1,50}$/.test(subId)) {
      throw httpError(400, 'Sub IDs must be alphanumeric and up to 50 characters.');
    }
  }

  return { links, subIds };
}

function chunk(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function normalizeProductInfoInput(body) {
  const url = String(body.url || body.link || '').trim();
  if (!url) {
    throw httpError(400, '`url` or `link` is required.');
  }
  return { url };
}

function normalizeProductInfoBatchInput(body) {
  const links = Array.isArray(body.urls) ? body.urls : Array.isArray(body.links) ? body.links : [];
  const inputs = links.map((url) => normalizeProductInfoInput({ url }));
  if (!inputs.length) {
    throw httpError(400, '`urls` or `links` is required.');
  }
  return inputs;
}

function normalizeProductIdBatchInput(body) {
  const links = Array.isArray(body.urls)
    ? body.urls
    : Array.isArray(body.links)
      ? body.links
      : body.url || body.link
        ? [body.url || body.link]
        : [];
  const inputs = links.map((url) => normalizeProductInfoInput({ url }));
  if (!inputs.length) {
    throw httpError(400, '`url`, `link`, `urls`, or `links` is required.');
  }
  return inputs;
}

function normalizeProductLinksInput(body) {
  const keyword = String(body.keyword || body.query || '').trim();
  const url = String(body.url || '').trim();
  const categoryUrl = String(body.categoryUrl || body.category || '').trim();
  const limit = Math.min(numberFromQuery(body.limit, 20), 500);
  const maxPages = Math.min(numberFromQuery(body.maxPages, Math.ceil(limit / 50) || 1), 50);

  if (!keyword && !url && !categoryUrl) {
    throw httpError(400, '`keyword`, `url`, or `categoryUrl` is required.');
  }

  return {
    keyword: keyword || undefined,
    url: url || undefined,
    categoryUrl: categoryUrl || undefined,
    limit,
    maxPages,
  };
}

function normalizeBrowserProductData(body) {
  const url = String(body.url || '').trim();
  const name = cleanProductName(body.name);
  if (!url) {
    throw httpError(400, '`url` is required.');
  }
  if (!name) {
    throw httpError(400, '`name` is required.');
  }

  const salePrice = normalizeBrowserPrice(body.salePrice ?? body.price);
  const priceBeforeDiscount = normalizeBrowserPrice(body.originalPrice ?? body.priceBeforeDiscount);
  const sold = normalizeBrowserCompactNumber(body.sold);

  return {
    source: 'browser',
    capturedAt: new Date().toISOString(),
    url,
    shopId: body.shopId ? String(body.shopId) : extractProductIds(url)?.shopId,
    itemId: body.itemId ? String(body.itemId) : extractProductIds(url)?.itemId,
    product: {
      name,
      description: normalizeText(body.description),
      currency: body.currency || 'VND',
      price: salePrice,
      salePrice,
      priceBeforeDiscount,
      discount: normalizeText(body.discount),
      sold,
      revenue: estimateRevenue(salePrice, sold),
      rating: normalizeBrowserNumber(body.rating),
      totalReviews: normalizeBrowserCompactNumber(body.totalRatings ?? body.totalReviews),
      shop: normalizeBrowserShop(body.shop),
      images: Array.isArray(body.images) ? body.images.map(String).filter(Boolean) : [],
      videos: Array.isArray(body.videos) && body.videos.length
        ? normalizeBrowserVideos(body.videos)
        : body.hasVideo
          ? [{ available: true }]
          : [],
    },
    reviews: body.reviews,
  };
}

function normalizeShopeeImage(image) {
  if (!image) return undefined;
  if (/^https?:\/\//i.test(image)) return image;
  return `https://down-vn.img.susercontent.com/file/${image}`;
}

function normalizeShopeeImages(images) {
  if (!Array.isArray(images)) return [];
  return [...new Set(images.map((image) => normalizeShopeeImage(image)).filter(Boolean))];
}

function normalizeShopeeVideoUrl(value) {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (typeof value === 'string') return `https://cvf.shopee.vn/file/${value}`;
  return undefined;
}

function normalizeShopeeVideos(videos) {
  if (!videos) return [];
  const rows = Array.isArray(videos) ? videos : [videos];

  return rows
    .map((video) => {
      if (typeof video === 'string') {
        return { url: normalizeShopeeVideoUrl(video) };
      }

      const url = firstDefined(
        video.default_format?.url,
        video.video_url,
        video.url,
        video.video_id,
        video.videoid,
      );
      const thumbnail = firstDefined(
        video.thumbnail,
        video.thumb_url,
        video.cover,
        video.default_format?.thumbnail,
      );

      return {
        id: firstDefined(video.video_id, video.videoid, video.id),
        url: normalizeShopeeVideoUrl(url),
        thumbnail: normalizeShopeeImage(thumbnail),
        duration: firstNumber(video.duration, video.default_format?.duration),
      };
    })
    .filter((video) => video.url || video.id);
}

function normalizeRatingCount(value) {
  if (!Array.isArray(value)) return undefined;
  const counts = value.map((count) => firstNumber(count) || 0);
  return {
    total: counts[0],
    fiveStar: counts[5],
    fourStar: counts[4],
    threeStar: counts[3],
    twoStar: counts[2],
    oneStar: counts[1],
  };
}

function estimateRevenue(price, sold) {
  if (!Number.isFinite(price) || !Number.isFinite(sold)) return undefined;
  return Math.round(price * sold);
}

function summarizeReviews(items) {
  const comments = items.map((item) => item.comment).filter(Boolean);
  if (!comments.length) {
    return {
      count: items.length,
      averageRating: average(items.map((item) => item.rating)),
      snippets: [],
    };
  }

  return {
    count: items.length,
    averageRating: average(items.map((item) => item.rating)),
    snippets: comments.slice(0, 5),
  };
}

function normalizeExtensionJobResult(type, payload) {
  if (type !== 'product-affiliate' || !payload || typeof payload !== 'object') return payload;
  const productData = payload.productData && typeof payload.productData === 'object'
    ? {
        ...payload.productData,
        name: cleanProductName(payload.productData.name),
      }
    : payload.productData;
  return { ...payload, productData };
}

function cleanProductName(value) {
  return normalizeText(String(value || '').replace(/\s*Click to Copy\s*$/i, ''));
}

function normalizeText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function parseVietnamDong(value) {
  const text = String(value || '').replace(/[^\d]/g, '');
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function parseLocaleNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(String(value).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(number) ? number : undefined;
}

function parseCompactNumber(value) {
  if (!value) return undefined;
  const text = String(value).trim().toLowerCase().replace('+', '');
  const multiplier = text.includes('k') ? 1000 : 1;
  const number = parseLocaleNumber(text.replace('k', ''));
  return Number.isFinite(number) ? Math.round(number * multiplier) : undefined;
}

function normalizeBrowserNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return parseLocaleNumber(value);
}

function normalizeBrowserPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return parseVietnamDong(value);
}

function normalizeBrowserCompactNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return parseCompactNumber(value);
}

function normalizeBrowserShop(value) {
  if (!value) return undefined;
  const rawName = typeof value === 'string' ? value : value.name || value.shopName || value.username;
  const name = normalizeShopName(rawName);
  return name ? { name } : undefined;
}

function normalizeBrowserVideos(videos) {
  const grouped = new Map();
  for (const video of videos) {
    const row = typeof video === 'string' ? { url: video } : video;
    if (!row?.url && !row?.id) continue;
    const key = browserVideoKey(row.url || row.id);
    const current = grouped.get(key);
    if (!current || browserVideoScore(row) > browserVideoScore(current)) grouped.set(key, row);
  }
  return [...grouped.values()];
}

function browserVideoKey(value) {
  const text = String(value || '');
  const file = text.split('/').pop() || text;
  return file.replace(/\.(?:default|\d+)\.mp4(?:\?.*)?$/i, '').replace(/\?.*$/, '') || text;
}

function browserVideoScore(video) {
  const url = String(video.url || '');
  if (/\.default\.mp4/i.test(url)) return 100;
  if (/mms\.vod\.susercontent/i.test(url)) return 80;
  if (/\.mp4/i.test(url)) return 50;
  if (/m3u8/i.test(url)) return 40;
  return video.url ? 10 : 1;
}

function normalizeShopName(value) {
  const text = normalizeText(value);
  if (!text) return undefined;
  if (text.length < 2 || text.length > 80) return undefined;
  if (/(\d+\s*(phút|giờ|ngày|minutes?|hours?|days?)\s*(ago|trước)|active\s+\d+|online|chat now|xem shop|view shop|followers|products|ratings|đang hoạt động|phản hồi)/i.test(text)) {
    return undefined;
  }
  return text;
}

function extractDescription(text) {
  const normalized = String(text || '').replace(/\r/g, '');
  const match = normalized.match(/Product Description\s*\n([\s\S]*?)(?:\nProduct Ratings|\nRatings|\nRecommended|$)/i);
  return normalizeText(match?.[1]);
}

function extractShopFromText(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const viewShopIndex = lines.findIndex((line) => /view shop/i.test(line));
  const name = viewShopIndex > 0 ? lines[viewShopIndex - 1] : undefined;
  return name ? { name } : undefined;
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return undefined;
  return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10;
}

function withoutRaw(value) {
  if (!value || typeof value !== 'object') return value;
  const { raw, ...rest } = value;
  return rest;
}

function normalizeShopeePrice(value) {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return number >= 100000 ? number / 100000 : number;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function enqueue(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

function assertAuthorized(req) {
  if (!API_TOKEN) return;
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${API_TOKEN}`) {
    throw httpError(401, 'Unauthorized');
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, 'Invalid JSON body.');
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-origin': '*',
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(statusCode === 204 ? '' : JSON.stringify(payload));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function numberFromQuery(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function truthyQuery(value) {
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const rows = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(item);
  }
  return rows;
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function loadDotEnv(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!match || match[1].startsWith('#')) continue;
      const [, key, rawValue] = match;
      if (process.env[key] === undefined) {
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {
    // .env is optional.
  }
}
