const DEFAULT_SETTINGS = {
  apiBase: 'http://127.0.0.1:8787',
  apiToken: 'change-me',
  enabled: true,
  affiliateUrl: 'https://affiliate.shopee.vn/offer/custom_link',
  subIds: ['n8n', '', '', '', ''],
  profileId: 'profile-1',
  profileName: 'Profile 1',
  facebookPublisherEnabled: true,
  facebookProfileId: 'facebook-profile-1',
  facebookProfileName: 'Facebook Profile 1',
  facebookTargetUrl: '',
  facebookPublishMode: 'auto',
  facebookCooldownMinutes: 45,
  facebookJitterMinutes: 10,
  facebookMaxPostsPerDay: 12,
  facebookCaption: '{name}\\n\\nGiá: {salePrice}\\nĐã bán: {sold}\\nLink mua: {affiliateLink}',
};

const TAB_READY_TIMEOUT_MS = 30000;
const COLLECT_TIMEOUT_MS = 25000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cachedAffiliateTabId;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...current });
  chrome.alarms.create('pollJobs', { periodInMinutes: 0.05 });
  chrome.alarms.create('pollFacebookJobs', { periodInMinutes: 0.2 });
  injectContentIntoShopeeTabs().catch(() => {});
  pollJobs().catch((error) => setStatus({ state: 'error', message: error.message }));
  pollFacebookJobs().catch((error) => setFacebookStatus({ state: 'error', message: error.message }));
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('pollJobs', { periodInMinutes: 0.05 });
  chrome.alarms.create('pollFacebookJobs', { periodInMinutes: 0.2 });
  injectContentIntoShopeeTabs().catch(() => {});
  pollJobs().catch((error) => setStatus({ state: 'error', message: error.message }));
  pollFacebookJobs().catch((error) => setFacebookStatus({ state: 'error', message: error.message }));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollJobs') {
    pollJobs().catch((error) => setStatus({ state: 'error', message: error.message }));
  }
  if (alarm.name === 'pollFacebookJobs') {
    pollFacebookJobs().catch((error) => setFacebookStatus({ state: 'error', message: error.message }));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'collect-current-tab') {
    collectCurrentTab()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'collect-current-product-affiliate') {
    collectCurrentProductAffiliate()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'collect-product-url') {
    collectProductByUrl(message.url)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'collect-product-affiliate-url') {
    collectProductAffiliateByUrl(message.url, message.input || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'create-facebook-wrap-current-product') {
    createFacebookWrapForCurrentProduct()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'create-facebook-wrap-product-url') {
    createFacebookWrapForProductUrl(message.url, message.input || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'poll-now') {
    Promise.allSettled([pollJobs(), pollFacebookJobs()])
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'poll-facebook-now') {
    pollFacebookJobs()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'get-dashboard') {
    getDashboard()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'check-server') {
    checkServer()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'run-ai-diagnostics') {
    runAiDiagnostics({ repair: false, symptoms: message.symptoms || [] })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'run-ai-fix') {
    runAiDiagnostics({ repair: true, symptoms: message.symptoms || ['buttons_not_visible', 'extension_not_working'] })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'download-media') {
    downloadMedia(message.items || [])
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'open-manager') {
    chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

async function pollJobs() {
  const settings = await getSettings();
  if (!settings.enabled) return { skipped: true };

  await sendHeartbeat(settings, 'polling').catch(() => {});
  const query = new URLSearchParams({
    profileId: settings.profileId || 'profile-1',
    profileName: settings.profileName || settings.profileId || 'Profile 1',
  });
  const next = await apiFetch(settings, `/api/shopee/extension/jobs/next?${query.toString()}`);
  if (!next.job) {
    await setStatus({ state: 'idle', message: 'No queued jobs.' });
    await sendHeartbeat(settings, 'idle').catch(() => {});
    return next;
  }

  await setStatus({ state: 'running', message: `Collecting job ${next.job.id}` });
  await runJob(settings, next.job);
  return next;
}

async function getDashboard() {
  const settings = await getSettings();
  const local = await chrome.storage.local.get({ lastStatus: null, lastFacebookStatus: null, latestProductData: null });
  let server = { ok: false };
  let jobs = [];
  let facebookJobs = [];

  try {
    server = await apiFetch(settings, '/health');
  } catch (error) {
    server = { ok: false, error: error.message };
  }

  try {
    const response = await apiFetch(settings, '/api/shopee/extension/jobs?limit=5');
    jobs = response.jobs || [];
  } catch {
    jobs = [];
  }

  try {
    const response = await apiFetch(settings, '/api/social/facebook/jobs?limit=5');
    facebookJobs = (response.jobs || []).map((job) => ({ ...job, jobSource: 'facebook' }));
  } catch {
    facebookJobs = [];
  }

  return {
    settings,
    server,
    jobs: [...facebookJobs, ...jobs],
    lastStatus: local.lastStatus,
    lastFacebookStatus: local.lastFacebookStatus,
    latestProductData: local.latestProductData,
  };
}

async function checkServer() {
  const settings = await getSettings();
  const server = await apiFetch(settings, '/health');
  await setStatus({ state: server.ok ? 'connected' : 'error', message: server.ok ? 'Server connected.' : 'Server failed.' });
  return server;
}

async function runJob(settings, job) {
  let tab;
  try {
    const result = await runTypedJob(settings, job);

    await apiFetch(settings, `/api/shopee/extension/jobs/${encodeURIComponent(job.id)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ result, profileId: settings.profileId || 'profile-1' }),
    });
    if (result.productData || result.source === 'extension') {
      await chrome.storage.local.set({ latestProductData: result.productData || result });
    }
    await setStatus({ state: 'completed', message: `Completed job ${job.id}` });
  } catch (error) {
    await apiFetch(settings, `/api/shopee/extension/jobs/${encodeURIComponent(job.id)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ error: error.message, profileId: settings.profileId || 'profile-1' }),
    }).catch(() => {});
    await setStatus({ state: 'error', message: error.message });
  }
}

async function pollFacebookJobs() {
  const settings = await getSettings();
  if (!settings.enabled || !settings.facebookPublisherEnabled) return { skipped: true };

  const query = new URLSearchParams({
    profileId: settings.facebookProfileId || settings.profileId || 'facebook-profile-1',
    profileName: settings.facebookProfileName || settings.profileName || 'Facebook Profile 1',
    extensionVersion: chrome.runtime.getManifest().version,
  });
  const response = await apiFetch(settings, `/api/social/facebook/jobs/next?${query.toString()}`);
  if (!response.job) {
    await setFacebookStatus({ state: 'idle', message: 'No Facebook jobs.' });
    return response;
  }

  const job = applyFacebookLocalDefaults(response.job, settings);
  await chrome.storage.local.set({ latestFacebookJob: job });
  await setFacebookStatus({ state: 'running', message: `Preparing ${job.id}` });

  try {
    const tab = await openFacebookTargetTab(job.targetUrl);
    const prepareResponse = await prepareFacebookJobInTab(tab.id, job);
    if (prepareResponse?.ok === false) {
      throw new Error(prepareResponse.error || 'Facebook content script failed.');
    }
    const publishResult = prepareResponse?.result || prepareResponse || {};

    if (publishResult.completed || publishResult.commented || (publishResult.published && publishResult.facebookPostUrl)) {
      const completeBody = {
        profileId: settings.facebookProfileId || settings.profileId || 'facebook-profile-1',
        extensionVersion: chrome.runtime.getManifest().version,
        status: publishResult.status || (publishResult.commented ? 'commented' : 'published'),
        targetUrl: job.targetUrl,
        publishMode: job.publishMode,
        facebookPostUrl: publishResult.facebookPostUrl || '',
        commentUrl: publishResult.commentUrl || '',
        facebookShopeeLinks: publishResult.facebookShopeeLinks || [],
        facebookWrappedShopeeLink: publishResult.facebookWrappedShopeeLink || '',
        note: publishResult.note || 'Facebook post was published by shopeeAI.',
      };
      await apiFetch(settings, `/api/social/facebook/jobs/${encodeURIComponent(job.id)}/complete`, {
        method: 'POST',
        body: JSON.stringify(completeBody),
      });
      await setFacebookStatus({ state: 'published', message: `${job.id} published.` });
      return { job, publishResult };
    }

    await apiFetch(settings, `/api/social/facebook/jobs/${encodeURIComponent(job.id)}/ready`, {
      method: 'POST',
      body: JSON.stringify({
        profileId: settings.facebookProfileId || settings.profileId || 'facebook-profile-1',
        extensionVersion: chrome.runtime.getManifest().version,
        status: publishResult.status || 'ready_for_publish',
        targetUrl: job.targetUrl,
        publishMode: job.publishMode,
        note: publishResult.note || 'Facebook post panel is ready. Review and publish from the browser.',
      }),
    });
    await setFacebookStatus({ state: 'ready', message: `${job.id} ready for publish.` });
    return { job, publishResult };
  } catch (error) {
    await apiFetch(settings, `/api/social/facebook/jobs/${encodeURIComponent(job.id)}/fail`, {
      method: 'POST',
      body: JSON.stringify({
        profileId: settings.facebookProfileId || settings.profileId || 'facebook-profile-1',
        extensionVersion: chrome.runtime.getManifest().version,
        error: error.message,
      }),
    }).catch(() => {});
    await setFacebookStatus({ state: 'error', message: error.message });
    throw error;
  }
}

function applyFacebookLocalDefaults(job, settings) {
  return {
    ...job,
    targetUrl: job.targetUrl || settings.facebookTargetUrl,
    publishMode: job.publishMode || settings.facebookPublishMode || 'auto',
  };
}

function resolveFacebookWrapPublishMode(settings) {
  const mode = String(settings.facebookPublishMode || '').trim().toLowerCase();
  if (mode === 'manual' || mode === 'confirm') return mode;
  return 'auto';
}

async function openFacebookTargetTab(url) {
  if (!url) throw new Error('Facebook target URL is required.');
  const existing = (await chrome.tabs.query({ url: 'https://www.facebook.com/*' }))
    .find((tab) => tab.url && normalizeUrl(tab.url) === normalizeUrl(url));
  const tab = existing || await chrome.tabs.create({ url, active: true });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.tabs.reload(existing.id);
  }
  await waitForFacebookTabComplete(tab.id);
  return chrome.tabs.get(tab.id);
}

async function prepareFacebookJobInTab(tabId, job) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['facebook-content.js'],
    });
    return await chrome.tabs.sendMessage(tabId, { type: 'prepare-facebook-post', job });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['facebook-content.js'],
    });
    return chrome.tabs.sendMessage(tabId, { type: 'prepare-facebook-post', job });
  }
}

function waitForFacebookTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Facebook tab load timed out.'));
    }, TAB_READY_TIMEOUT_MS);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (tab?.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(url || '');
  }
}

async function sendHeartbeat(settings, state) {
  return apiFetch(settings, '/api/shopee/extension/profiles/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      profileId: settings.profileId || 'profile-1',
      profileName: settings.profileName || settings.profileId || 'Profile 1',
      apiBase: settings.apiBase,
      extensionVersion: chrome.runtime.getManifest().version,
      userAgent: globalThis.navigator?.userAgent || '',
      state,
    }),
  });
}

async function injectContentIntoShopeeTabs() {
  const tabs = await chrome.tabs.query({ url: ['https://shopee.vn/*', 'https://affiliate.shopee.vn/*'] });
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id)
      .map((tab) => chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      })),
  );
}

async function runAiDiagnostics({ repair = false, symptoms = [] } = {}) {
  const settings = await getSettings();
  const fixes = [];
  let serverOk = false;
  let serverError = '';

  try {
    const health = await apiFetch(settings, '/health');
    serverOk = Boolean(health.ok);
  } catch (error) {
    serverError = error.message;
  }

  const shopeeTabs = await diagnoseShopeeTabs(repair, fixes);
  const local = await chrome.storage.local.get({ lastStatus: null, latestProductData: null });
  const reportInput = {
    source: 'shopeeAI-extension',
    profileId: settings.profileId || 'profile-1',
    extensionVersion: chrome.runtime.getManifest().version,
    symptoms,
    fixes,
    checks: {
      serverOk,
      serverError,
      apiBase: settings.apiBase,
      profileId: settings.profileId || 'profile-1',
      enabled: Boolean(settings.enabled),
      facebookTargetUrlConfigured: Boolean(String(settings.facebookTargetUrl || '').trim()),
      facebookPublishMode: settings.facebookPublishMode || 'auto',
      lastStatus: local.lastStatus,
      latestProductKey: local.latestProductData?.shopId && local.latestProductData?.itemId
        ? `${local.latestProductData.shopId}.${local.latestProductData.itemId}`
        : '',
      shopeeTabs,
    },
  };

  let serverReport;
  if (serverOk) {
    serverReport = await apiFetch(settings, '/api/ai/diagnostics/report', {
      method: 'POST',
      body: JSON.stringify(reportInput),
    }).catch((error) => ({ ok: false, error: error.message }));
  }
  const report = serverReport?.report || {
    ...reportInput,
    analysis: localAiAnalysis(reportInput),
  };
  await chrome.storage.local.set({ latestAiDiagnostic: report });
  await setStatus({
    state: report.analysis?.status === 'ok' ? 'completed' : 'error',
    message: repair ? 'AI fix completed.' : 'AI diagnostics completed.',
  });
  return report;
}

async function diagnoseShopeeTabs(repair, fixes) {
  const tabs = await chrome.tabs.query({ url: ['https://shopee.vn/*', 'https://affiliate.shopee.vn/*'] });
  const rows = [];
  for (const tab of tabs) {
    if (!tab.id) continue;
    if (repair) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
      fixes.push(`Injected content.js into ${tab.url}`);
    }
    let row = await diagnoseShopeeTab(tab);
    if (repair && (!row.ok || !row.panelExists || (row.isProductPage && !row.detailToolButtons && !row.cardToolbars))) {
      await sendTabMessage(tab.id, { type: 'repair-shopee-ui' }).catch(() => undefined);
      await delay(500);
      fixes.push(`Reset shopeeAI UI on ${tab.url}`);
      row = await diagnoseShopeeTab(tab);
    }
    rows.push(row);
  }
  return rows;
}

async function diagnoseShopeeTab(tab) {
  const base = {
    tabId: tab.id,
    title: tab.title || '',
    url: tab.url || '',
    injected: false,
    ok: false,
  };
  try {
    const response = await sendTabMessage(tab.id, { type: 'diagnose-shopee-ui' });
    return { ...base, ...(response?.result || {}), injected: true, ok: Boolean(response?.ok) };
  } catch (error) {
    return { ...base, error: error.message };
  }
}

function localAiAnalysis(report) {
  const tabs = report.checks?.shopeeTabs || [];
  const issues = [];
  const actions = [];
  if (!report.checks?.serverOk) {
    issues.push('Server API không phản hồi.');
    actions.push('Khởi động lại server hoặc kiểm tra API base/token.');
  }
  if (!tabs.length) {
    issues.push('Không tìm thấy tab Shopee đang mở.');
    actions.push('Mở trang Shopee rồi chạy AI fix lại.');
  }
  if (tabs.some((tab) => !tab.ok)) {
    issues.push('Có tab Shopee chưa nhận content script.');
    actions.push('Reload extension và inject lại content script.');
  }
  if (tabs.some((tab) => tab.ok && !tab.panelExists)) {
    issues.push('Panel shopeeAI chưa được tạo trên tab Shopee.');
    actions.push('Reset UI trên tab Shopee.');
  }
  if (tabs.some((tab) => tab.isProductPage && !tab.detailToolButtons && !tab.cardToolbars)) {
    issues.push('Không thấy button sản phẩm trên trang Shopee.');
    actions.push('Gắn lại toolbar bằng fallback floating.');
  }
  if (!issues.length) issues.push('Diagnostic không phát hiện lỗi rõ ràng.');
  if (!actions.length) actions.push('Reload tab Shopee nếu UI vẫn chưa hiện.');
  return { status: issues.length ? 'needs_attention' : 'ok', issues, actions };
}

async function runTypedJob(settings, job) {
  if (job.type === 'product-links') {
    return {
      type: job.type,
      productLinks: await collectProductLinksAcrossPages(job.input || {}),
    };
  }

  if (job.type === 'affiliate-links') {
    const cached = await getAffiliateCache(job.input);
    if (cached) {
      return {
        type: job.type,
        affiliateLink: cached,
        cacheHit: true,
      };
    }
    const affiliateTab = await getAffiliateTab(settings);
    const affiliateLink = await collectAffiliateLinksFromTab(affiliateTab.id, job.input);
    await setAffiliateCache(job.input, affiliateLink);
    return { type: job.type, affiliateLink };
  }

  if (job.type === 'product-affiliate') {
    const cachedProduct = await getProductCacheByUrl(job.url);
    if (cachedProduct) {
      return {
        type: job.type,
        ...(await collectProductAffiliateForProduct(settings, cachedProduct, job.input)),
        productCacheHit: true,
      };
    }
    const productTab = await openReadyTab(job.url);
    try {
      const productData = await collectFromTab(productTab.id);
      await setProductCache(productData);
      return {
        type: job.type,
        ...(await collectProductAffiliateForProduct(settings, productData, job.input)),
      };
    } finally {
      await closeTab(productTab);
    }
  }

  const productTab = await openReadyTab(job.url);
  try {
    const productData = await collectFromTab(productTab.id);
    await setProductCache(productData);
    return productData;
  } finally {
    await closeTab(productTab);
  }
}

function buildShopeeListingUrl(input) {
  if (input.url) return input.url;
  if (input.categoryUrl) return input.categoryUrl;
  if (input.keyword) return `https://shopee.vn/search?keyword=${encodeURIComponent(input.keyword)}`;
  throw new Error('`keyword`, `url`, or `categoryUrl` is required.');
}

async function collectProductLinksAcrossPages(input) {
  const limit = Math.min(Number(input.limit) || 20, 500);
  const maxPages = Math.min(Number(input.maxPages) || Math.ceil(limit / 50) || 1, 50);
  const links = [];
  const seen = new Set();
  const pageUrls = [];

  for (let pageIndex = 0; pageIndex < maxPages && links.length < limit; pageIndex += 1) {
    const pageUrl = buildShopeeListingPageUrl(input, pageIndex);
    pageUrls.push(pageUrl);
    const searchTab = await openReadyTab(pageUrl);
    try {
      const pageResult = await collectProductLinksFromTab(searchTab.id, {
        ...input,
        limit: Math.min(100, limit - links.length),
        page: pageIndex,
      });
      const pageLinks = pageResult.links || [];
      let added = 0;
      for (const link of pageLinks) {
        const key = `${link.shopId || ''}.${link.itemId || link.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push(link);
        added += 1;
        if (links.length >= limit) break;
      }
      if (!pageLinks.length || added === 0) break;
    } finally {
      await closeTab(searchTab);
    }
  }

  return {
    source: 'extension',
    pageUrl: pageUrls[0],
    pageUrls,
    keyword: input.keyword,
    categoryUrl: input.categoryUrl,
    count: links.length,
    limit,
    maxPages,
    links,
    capturedAt: new Date().toISOString(),
  };
}

function buildShopeeListingPageUrl(input, pageIndex) {
  const url = new URL(buildShopeeListingUrl(input));
  if (pageIndex > 0 || url.searchParams.has('page')) {
    url.searchParams.set('page', String(pageIndex));
  }
  return url.href;
}

async function collectCurrentTab() {
  const settings = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');

  const productData = await collectFromTab(tab.id);
  await apiFetch(settings, '/api/shopee/browser-product-data', {
    method: 'POST',
    body: JSON.stringify(productData),
  });
  await chrome.storage.local.set({ latestProductData: productData });
  await setStatus({ state: 'completed', message: 'Collected current tab.' });
  return productData;
}

async function collectCurrentProductAffiliate() {
  const settings = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');

  const productData = await collectFromTab(tab.id);
  const result = {
    type: 'product-affiliate',
    ...(await collectProductAffiliateForProduct(settings, productData, {
      links: [productData.url],
      subIds: normalizeSubIds(settings.subIds),
    })),
  };
  await chrome.storage.local.set({ latestProductData: productData });
  await setStatus({ state: 'completed', message: 'Collected affiliate for current product.' });
  return result;
}

async function collectProductByUrl(url) {
  if (!url) throw new Error('Product URL is required.');
  const cached = await getProductCacheByUrl(url);
  if (cached) return cached;
  const tab = await openReadyTab(url);
  try {
    const productData = await collectFromTab(tab.id);
    await setProductCache(productData);
    await chrome.storage.local.set({ latestProductData: productData });
    await setStatus({ state: 'completed', message: 'Collected product from listing card.' });
    return productData;
  } finally {
    await closeTab(tab);
  }
}

async function collectProductAffiliateByUrl(url, input = {}) {
  const settings = await getSettings();
  const productData = await collectProductByUrl(url);
  const result = {
    type: 'product-affiliate',
    ...(await collectProductAffiliateForProduct(settings, productData, {
      ...input,
      links: [productData.url || url],
      subIds: normalizeSubIds(input.subIds?.length ? input.subIds : settings.subIds),
    })),
  };
  await chrome.storage.local.set({ latestProductData: productData });
  await setStatus({ state: 'completed', message: 'Collected affiliate from listing card.' });
  return result;
}

async function createFacebookWrapForCurrentProduct() {
  const settings = await getSettings();
  const affiliateResult = await collectCurrentProductAffiliate();
  return createFacebookWrapJob(settings, affiliateResult);
}

async function createFacebookWrapForProductUrl(url, input = {}) {
  const settings = await getSettings();
  const affiliateResult = await collectProductAffiliateByUrl(url, input);
  return createFacebookWrapJob(settings, affiliateResult);
}

async function createFacebookWrapJob(settings, affiliateResult) {
  try {
    const targetUrl = String(settings.facebookTargetUrl || '').trim() || await inferFacebookTargetUrlFromTabs();
    if (!targetUrl) {
      throw new Error('Facebook target URL is not configured. Open shopeeAI Manager settings and save Default Facebook target URL.');
    }
    if (!settings.facebookTargetUrl && targetUrl) {
      await chrome.storage.local.set({ facebookTargetUrl: targetUrl });
    }

    const productData = affiliateResult?.productData || {};
    const affiliateLink = getPrimaryAffiliateLink(affiliateResult?.affiliateLink);
    if (!affiliateLink) {
      throw new Error(affiliateResult?.affiliateLink?.error || 'No affiliate link returned.');
    }

    const body = {
      type: 'facebook-publish-post',
      targetUrl,
      affiliateLink,
      caption: renderFacebookCaptionTemplate(settings.facebookCaption, productData, affiliateLink),
      publishMode: resolveFacebookWrapPublishMode(settings),
      wrapMode: true,
      targetProfileId: settings.facebookProfileId || '',
      productKey: productData.shopId && productData.itemId ? `${productData.shopId}.${productData.itemId}` : '',
      media: Array.isArray(productData.images) ? productData.images.slice(0, 4) : [],
      schedule: {
        cooldownMinutes: Number(settings.facebookCooldownMinutes) || 45,
        jitterMinutes: Number(settings.facebookJitterMinutes) || 10,
        maxPostsPerDay: Number(settings.facebookMaxPostsPerDay) || 12,
      },
    };

    const response = await apiFetch(settings, '/api/social/facebook/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await setStatus({ state: 'queued', message: `Created Facebook wrap job ${response.job?.id || ''}`.trim() });
    return {
      ...affiliateResult,
      facebookJob: response.job,
      facebookTargetUrl: targetUrl,
      facebookWrapMode: true,
    };
  } catch (error) {
    await setStatus({ state: 'error', message: error.message });
    await reportFacebookWrapFailure(settings, affiliateResult, error).catch(() => {});
    throw error;
  }
}

async function inferFacebookTargetUrlFromTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
  const candidates = tabs
    .map((tab) => tab.url || '')
    .filter((url) => {
      try {
        const parsed = new URL(url);
        if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return false;
        return !/\/plugins\/|\/login|\/checkpoint|\/sharer|\/dialog/i.test(parsed.pathname);
      } catch {
        return false;
      }
    });
  return candidates[0] || '';
}

function getPrimaryAffiliateLink(affiliateLink) {
  const row = Array.isArray(affiliateLink?.links) ? affiliateLink.links[0] : undefined;
  return row?.shortLink || row?.affiliateLink || row?.url || '';
}

function renderFacebookCaptionTemplate(template, productData, affiliateLink) {
  const product = productData || {};
  const values = {
    name: cleanText(product.name || ''),
    salePrice: product.salePrice || product.price || '',
    originalPrice: product.originalPrice || '',
    discount: product.discount || '',
    sold: product.sold || '',
    rating: product.rating || '',
    shop: product.shop?.name || '',
    affiliateLink,
  };
  return String(template || DEFAULT_SETTINGS.facebookCaption)
    .replace(/\\n/g, '\n')
    .replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? '');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function reportFacebookWrapFailure(settings, affiliateResult, error) {
  const productData = affiliateResult?.productData || {};
  const fixes = [];
  const shopeeTabs = await diagnoseShopeeTabs(false, fixes).catch(() => []);
  return apiFetch(settings, '/api/ai/diagnostics/report', {
    method: 'POST',
    body: JSON.stringify({
      source: 'shopeeAI-extension',
      profileId: settings.profileId || 'profile-1',
      extensionVersion: chrome.runtime.getManifest().version,
      symptoms: ['fb_wrap_failed'],
      fixes,
      checks: {
        serverOk: true,
        apiBase: settings.apiBase,
        profileId: settings.profileId || 'profile-1',
        facebookTargetUrlConfigured: Boolean(String(settings.facebookTargetUrl || '').trim()),
        facebookPublishMode: settings.facebookPublishMode || 'auto',
        affiliateLinkAvailable: Boolean(getPrimaryAffiliateLink(affiliateResult?.affiliateLink)),
        affiliateError: affiliateResult?.affiliateLink?.error || '',
        productKey: productData.shopId && productData.itemId ? `${productData.shopId}.${productData.itemId}` : '',
        fbWrapError: error.message,
        shopeeTabs,
      },
    }),
  });
}

async function collectProductAffiliateForProduct(settings, productData, input) {
  let offerTab;
  try {
    const affiliateOffer = productData.itemId
      ? await getOfferCache(productData.itemId) || await (async () => {
          offerTab = await openReadyTab(`https://affiliate.shopee.vn/offer/product_offer/${encodeURIComponent(productData.itemId)}`);
          const offer = await collectAffiliateOfferFromTab(offerTab.id, productData.itemId).catch((error) => ({
            available: false,
            error: error.message,
          }));
          await setOfferCache(productData.itemId, offer);
          return offer;
        })()
      : undefined;

    const cachedAffiliate = await getAffiliateCache(input);
    const affiliateLink = cachedAffiliate || await (async () => {
      const affiliateTab = await getAffiliateTab(settings);
      const link = await collectAffiliateLinksFromTab(affiliateTab.id, input).catch((error) => ({
        available: false,
        error: error.message,
      }));
      if (link?.available !== false) await setAffiliateCache(input, link);
      return link;
    })();

    return { productData, affiliateOffer, affiliateLink, cacheHit: Boolean(cachedAffiliate) };
  } finally {
    await closeTab(offerTab);
  }
}

async function collectFromTab(tabId) {
  const response = await withTimeout(sendTabMessage(tabId, { type: 'collect-shopee-product' }), COLLECT_TIMEOUT_MS, 'Product collection timed out.');

  if (!response?.ok) {
    throw new Error(response?.error || 'Could not collect Shopee product data.');
  }

  return response.productData;
}

async function sendTabMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(async () => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return chrome.tabs.sendMessage(tabId, message);
  });
}

async function collectAffiliateLinksFromTab(tabId, input) {
  const response = await withTimeout(
    sendTabMessage(tabId, { type: 'collect-affiliate-links', input }),
    COLLECT_TIMEOUT_MS,
    'Affiliate link collection timed out.',
  );
  if (!response?.ok) {
    if (/Affiliate UI returned \d+ links for \d+ inputs/i.test(response?.error || '')) {
      const fallback = await extractAffiliateLinksFromTab(tabId, input);
      if (fallback.links.length) return fallback;
    }
    throw new Error(response?.error || 'Could not collect affiliate links.');
  }
  return response.result;
}

async function extractAffiliateLinksFromTab(tabId, input) {
  const links = Array.isArray(input?.links) ? input.links : [];
  const expectedCount = Math.max(1, links.length);
  const rows = await chrome.scripting.executeScript({
    target: { tabId },
    func: (count) => {
      const textValues = [
        ...[...document.querySelectorAll('textarea, input')].map((node) => node.value || node.textContent || ''),
        document.body?.innerText || '',
      ];
      const values = [...new Set(textValues
        .flatMap((value) => String(value).split(/\s+/))
        .map((value) => value.trim().replace(/[),.;\]]+$/g, ''))
        .filter((value) => /^https:\/\/s\.shopee\./i.test(value)))];
      return values.slice(-count);
    },
    args: [expectedCount],
  });
  const shortLinks = rows?.[0]?.result || [];
  return {
    strategy: 'extension_ui_recovered',
    links: shortLinks.map((shortLink, index) => ({
      originalLink: links[index] || links[0],
      shortLink,
    })),
  };
}

async function collectAffiliateOfferFromTab(tabId, itemId) {
  const response = await withTimeout(
    sendTabMessage(tabId, { type: 'collect-affiliate-offer', itemId }),
    COLLECT_TIMEOUT_MS,
    'Affiliate offer collection timed out.',
  );
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not collect affiliate offer.');
  }
  return response.result;
}

async function collectProductLinksFromTab(tabId, input) {
  const response = await withTimeout(
    sendTabMessage(tabId, { type: 'collect-product-links', input }),
    COLLECT_TIMEOUT_MS,
    'Product link collection timed out.',
  );
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not collect product links.');
  }
  return response.result;
}

async function getAffiliateTab(settings) {
  if (cachedAffiliateTabId) {
    const existing = await chrome.tabs.get(cachedAffiliateTabId).catch(() => undefined);
    if (existing?.id) return existing;
    cachedAffiliateTabId = undefined;
  }

  const tabs = await chrome.tabs.query({ url: 'https://affiliate.shopee.vn/offer/custom_link*' });
  const existing = tabs.find((tab) => tab.id);
  if (existing?.id) {
    cachedAffiliateTabId = existing.id;
    await chrome.tabs.update(existing.id, { active: false }).catch(() => {});
    await delay(700);
    return existing;
  }

  const tab = await openReadyTab(settings.affiliateUrl);
  cachedAffiliateTabId = tab.id;
  return tab;
}

async function getProductCacheByUrl(url) {
  const ids = extractProductIdsFromUrl(url);
  if (!ids) return undefined;
  return getCache(`cache.product.${ids.shopId}.${ids.itemId}`);
}

async function setProductCache(productData) {
  if (!productData?.shopId || !productData?.itemId) return;
  await setCache(`cache.product.${productData.shopId}.${productData.itemId}`, productData);
}

async function getOfferCache(itemId) {
  if (!itemId) return undefined;
  return getCache(`cache.offer.${itemId}`);
}

async function setOfferCache(itemId, offer) {
  if (!itemId || !offer) return;
  await setCache(`cache.offer.${itemId}`, offer);
}

async function getAffiliateCache(input) {
  return getCache(`cache.affiliate.${affiliateCacheKey(input)}`);
}

async function setAffiliateCache(input, affiliateLink) {
  if (!affiliateLink?.links?.length) return;
  await setCache(`cache.affiliate.${affiliateCacheKey(input)}`, affiliateLink);
}

async function getCache(key) {
  const row = (await chrome.storage.local.get(key))[key];
  if (!row || Date.now() - Number(row.at || 0) > CACHE_TTL_MS) return undefined;
  return row.value;
}

async function setCache(key, value) {
  await chrome.storage.local.set({ [key]: { at: Date.now(), value } });
}

function affiliateCacheKey(input = {}) {
  const links = Array.isArray(input.links) ? input.links : [];
  const subIds = Array.isArray(input.subIds) ? input.subIds : [];
  return encodeURIComponent(JSON.stringify({ links, subIds }));
}

function extractProductIdsFromUrl(url) {
  const text = String(url || '');
  const patterns = [
    /(?:^|[/?&.-])i\.(\d+)\.(\d+)(?:[/?&#]|$)/i,
    /\/product\/(\d+)\/(\d+)(?:[/?&#]|$)/i,
  ];
  for (const pattern of patterns) {
    const row = text.match(pattern);
    if (row) return { shopId: row[1], itemId: row[2] };
  }
  return undefined;
}

async function openReadyTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await withTimeout(waitForTabComplete(tab.id), TAB_READY_TIMEOUT_MS, `Tab load timed out: ${url}`);
  await delay(2500);
  return tab;
}

async function closeTab(tab) {
  if (!tab?.id) return;
  await chrome.tabs.remove(tab.id).catch(() => {});
}

async function apiFetch(settings, path, options = {}) {
  const response = await fetch(`${settings.apiBase}${path}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${settings.apiToken}`,
      'content-type': 'application/json',
    },
    body: options.body,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `API request failed: ${response.status}`);
  }
  return body;
}

async function downloadMedia(items) {
  const rows = items
    .map((item, index) => ({
      url: typeof item === 'string' ? item : item.url,
      filename: typeof item === 'string' ? `shopee-media-${index + 1}` : item.filename || `shopee-media-${index + 1}`,
    }))
    .filter((item) => item.url);

  for (const item of rows) {
    await chrome.downloads.download({
      url: item.url,
      filename: safeDownloadFilename(item.filename, item.url),
      saveAs: false,
    });
  }

  return { count: rows.length };
}

function safeDownloadFilename(name, url) {
  const extension = inferExtension(url);
  const base = String(name || 'shopee-media')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `shopee/${base}${extension}`;
}

function inferExtension(url) {
  const path = new URL(url).pathname;
  const match = path.match(/\.(jpg|jpeg|png|webp|gif|mp4|m3u8)$/i);
  if (match) return `.${match[1].toLowerCase()}`;
  if (/cvf|video|mp4/i.test(url)) return '.mp4';
  return '.jpg';
}

async function getSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...settings };
}

function normalizeSubIds(subIds) {
  return Array.from({ length: 5 }, (_, index) => String(subIds?.[index] || '').trim());
}

async function setStatus(status) {
  await chrome.storage.local.set({ lastStatus: { ...status, at: new Date().toISOString() } });
}

async function setFacebookStatus(status) {
  await chrome.storage.local.set({ lastFacebookStatus: { ...status, at: new Date().toISOString() } });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}
