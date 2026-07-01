const DEFAULT_SETTINGS = {
  apiBase: 'http://127.0.0.1:8787',
  apiToken: 'change-me',
  affiliateUrl: 'https://affiliate.shopee.vn/offer/custom_link',
  enabled: true,
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
  facebookCommentPostUrls: '',
  facebookCommentMode: 'specific',
};

let settings;
let selectedJob;
let allJobs = [];

const API_DOC_SECTIONS = [
  {
    title: 'Basics',
    text: 'Base URL defaults to http://127.0.0.1:8787. Send Authorization: Bearer <API_TOKEN> for every API except /health.',
    endpoints: [
      ['GET', '/health', 'Check whether the API server is alive.'],
      ['GET', '/api/shopee/product-id?url=<product_url>', 'Parse shopId and itemId from one Shopee product URL. Add resolve=1 for short/redirect URLs.'],
      ['POST', '/api/shopee/product-id', 'Body: {"url":"https://shopee.vn/...","resolve":false}.'],
      ['POST', '/api/shopee/product-ids', 'Body: {"links":["https://shopee.vn/..."],"resolve":false}.'],
    ],
  },
  {
    title: 'Browser/Extension Jobs',
    text: 'Recommended for Shopee pages because jobs run inside your real Chrome profile, cookies, and installed extension.',
    endpoints: [
      ['POST', '/api/shopee/extension/jobs', 'Create a queued job. Body type: product-info, product-affiliate, product-links, or affiliate-links.'],
      ['GET', '/api/shopee/extension/jobs/created?limit=100&status=completed', 'List created jobs with optional status filter.'],
      ['GET', '/api/shopee/extension/jobs/<id>', 'Read one job and its result.'],
      ['POST', '/api/shopee/extension/jobs/<id>/retry', 'Retry a failed/cancelled/completed job.'],
      ['POST', '/api/shopee/extension/jobs/<id>/cancel', 'Cancel a queued/running job.'],
      ['POST', '/api/shopee/extension/jobs/clear', 'Body: {"status":"completed"} to clear jobs by status.'],
    ],
  },
  {
    title: 'Affiliate',
    text: 'Shopee custom link UI supports 5 links per request. Use batch endpoint for larger lists.',
    endpoints: [
      ['POST', '/api/shopee/extension/affiliate-links', 'Queue affiliate conversion for up to 5 links. Supports subId1..subId5.'],
      ['POST', '/api/shopee/extension/affiliate-links/batch', 'Queue unlimited links; server chunks into jobs of 5 links. Supports subId1..subId5.'],
      ['POST', '/api/shopee/extension/product-affiliate', 'Collect product info, affiliate offer, and custom affiliate link for one product URL.'],
      ['POST', '/api/shopee/affiliate-links', 'Legacy Playwright flow for up to 5 links. Prefer extension endpoint.'],
      ['POST', '/api/shopee/product-affiliate', 'Legacy Playwright product info + affiliate link. Prefer extension endpoint.'],
    ],
  },
  {
    title: 'Product Data',
    text: 'Product data includes name, description, price, sale price, sold count, shop, ratings, reviews, images, and videos when available.',
    endpoints: [
      ['POST', '/api/shopee/extension/product-info', 'Queue product info collection for one product URL.'],
      ['POST', '/api/shopee/extension/product-links', 'Queue product link discovery from keyword, search URL, or category URL. Body supports limit and maxPages.'],
      ['POST', '/api/shopee/product-info', 'Legacy direct product info.'],
      ['POST', '/api/shopee/product-info/batch', 'Legacy direct batch product info.'],
      ['POST', '/api/shopee/product-data', 'Legacy direct product info plus reviews.'],
      ['GET', '/api/shopee/browser-product-data/latest', 'Read latest product payload posted by the extension.'],
    ],
  },
  {
    title: 'Profiles',
    text: 'Use profiles when multiple Chrome sessions/extensions connect to one API server.',
    endpoints: [
      ['GET', '/api/shopee/extension/profiles', 'List extension profiles and heartbeat status.'],
      ['POST', '/api/shopee/extension/profiles/heartbeat', 'Extension heartbeat endpoint. Usually called automatically.'],
    ],
  },
  {
    title: 'AI Diagnostics',
    text: 'Rule-based self-healing diagnostics for extension injection, missing Shopee buttons, server connectivity, and queue state.',
    endpoints: [
      ['POST', '/api/ai/diagnostics/report', 'Extension posts diagnostic reports and receives issues/actions.'],
      ['GET', '/api/ai/diagnostics/latest?limit=10', 'Read latest AI diagnostic reports.'],
    ],
  },
  {
    title: 'Facebook Publisher',
    text: 'Helpers for returning a Facebook Embedded Post after a Shopee affiliate link is posted on a validated Facebook channel.',
    endpoints: [
      ['POST', '/api/social/facebook/embed', 'Body: {"postUrl":"https://www.facebook.com/.../posts/...","width":500,"showText":true}.'],
      ['POST', '/api/social/facebook/extract-shopee-links', 'Extract Shopee links from Facebook text, hrefs, or l.facebook.com redirect URLs.'],
      ['POST', '/api/social/facebook/jobs', 'Create a Facebook Publisher job. Body includes targetUrl, affiliateLink, caption, publishMode, and schedule.'],
      ['POST', '/api/social/facebook/jobs', 'Create a Facebook wrap job, then copy result.facebookWrappedShopeeLink after published.'],
      ['POST', '/api/social/facebook/jobs', 'Create a Facebook comment job with type=facebook-comment, commentText, targetPostUrls, and commentMode=random|specific.'],
      ['GET', '/api/social/facebook/jobs?limit=50', 'List Facebook Publisher jobs.'],
    ],
  },
];

const els = {
  apiBase: document.querySelector('#apiBase'),
  apiToken: document.querySelector('#apiToken'),
  affiliateUrl: document.querySelector('#affiliateUrl'),
  settingsFacebookTargetUrl: document.querySelector('#settingsFacebookTargetUrl'),
  facebookPublisherEnabled: document.querySelector('#facebookPublisherEnabled'),
  facebookProfileId: document.querySelector('#facebookProfileId'),
  facebookProfileName: document.querySelector('#facebookProfileName'),
  profileId: document.querySelector('#profileId'),
  profileName: document.querySelector('#profileName'),
  enabled: document.querySelector('#enabled'),
  serverStatus: document.querySelector('#serverStatus'),
  aiStatus: document.querySelector('#aiStatus'),
  aiSummary: document.querySelector('#aiSummary'),
  jobType: document.querySelector('#jobType'),
  jobUrl: document.querySelector('#jobUrl'),
  keyword: document.querySelector('#keyword'),
  limit: document.querySelector('#limit'),
  targetProfileId: document.querySelector('#targetProfileId'),
  subId1: document.querySelector('#subId1'),
  subId2: document.querySelector('#subId2'),
  subId3: document.querySelector('#subId3'),
  subId4: document.querySelector('#subId4'),
  subId5: document.querySelector('#subId5'),
  facebookTargetUrl: document.querySelector('#facebookTargetUrl'),
  facebookPublishMode: document.querySelector('#facebookPublishMode'),
  facebookCooldownMinutes: document.querySelector('#facebookCooldownMinutes'),
  facebookCaption: document.querySelector('#facebookCaption'),
  facebookCommentPostUrls: document.querySelector('#facebookCommentPostUrls'),
  facebookCommentMode: document.querySelector('#facebookCommentMode'),
  filterStatus: document.querySelector('#filterStatus'),
  statQueued: document.querySelector('#statQueued'),
  statRunning: document.querySelector('#statRunning'),
  statCompleted: document.querySelector('#statCompleted'),
  statFailed: document.querySelector('#statFailed'),
  jobs: document.querySelector('#jobs'),
  resultSummary: document.querySelector('#resultSummary'),
  resultJson: document.querySelector('#resultJson'),
  toast: document.querySelector('#toast'),
  apiDocsContent: document.querySelector('#apiDocsContent'),
};

init();

document.querySelector('#saveSettings').addEventListener('click', saveSettings);
document.querySelector('#checkServer').addEventListener('click', checkServer);
document.querySelector('#runAiDiagnostics').addEventListener('click', () => runAiTool(false));
document.querySelector('#runAiFix').addEventListener('click', () => runAiTool(true));
document.querySelector('#createJob').addEventListener('click', createJob);
document.querySelector('#runQueue').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'poll-now' }).then(refreshJobs));
document.querySelector('#openSettings').addEventListener('click', openSettings);
document.querySelector('#closeSettings').addEventListener('click', closeSettings);
document.querySelector('#closeSettingsButton').addEventListener('click', closeSettings);
document.querySelector('#openApiDocs').addEventListener('click', openApiDocs);
document.querySelector('#closeApiDocs').addEventListener('click', closeApiDocs);
document.querySelector('#closeApiDocsButton').addEventListener('click', closeApiDocs);
document.querySelector('#copyApiDocs').addEventListener('click', copyApiDocs);
document.querySelector('#copyApiBase').addEventListener('click', copyApiBase);
document.querySelector('#refreshJobs').addEventListener('click', refreshJobs);
document.querySelector('#clearCompleted').addEventListener('click', () => clearJobs('completed'));
document.querySelector('#copyResult').addEventListener('click', copyResult);
document.querySelector('#copyProductName').addEventListener('click', copyProductName);
document.querySelector('#copyDescription').addEventListener('click', copyDescription);
document.querySelector('#copyProductLink').addEventListener('click', copyProductLink);
document.querySelector('#copyAffiliateLink').addEventListener('click', copyAffiliateLink);
document.querySelector('#downloadImages').addEventListener('click', () => downloadMedia('images'));
document.querySelector('#downloadVideos').addEventListener('click', () => downloadMedia('videos'));
document.querySelector('#createFacebookJob').addEventListener('click', createFacebookJobFromSelected);
document.querySelector('#createFacebookWrapJob').addEventListener('click', createFacebookWrapJobFromSelected);
document.querySelector('#copyFacebookWrappedLink').addEventListener('click', copyFacebookWrappedLink);
els.filterStatus.addEventListener('change', () => renderJobs(allJobs));

async function init() {
  settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  els.apiBase.value = settings.apiBase;
  els.apiToken.value = settings.apiToken;
  els.affiliateUrl.value = settings.affiliateUrl;
  els.settingsFacebookTargetUrl.value = settings.facebookTargetUrl || '';
  els.facebookPublisherEnabled.checked = settings.facebookPublisherEnabled !== false;
  els.facebookProfileId.value = settings.facebookProfileId || DEFAULT_SETTINGS.facebookProfileId;
  els.facebookProfileName.value = settings.facebookProfileName || DEFAULT_SETTINGS.facebookProfileName;
  els.facebookTargetUrl.value = settings.facebookTargetUrl || '';
  els.facebookPublishMode.value = settings.facebookPublishMode || DEFAULT_SETTINGS.facebookPublishMode;
  els.facebookCooldownMinutes.value = settings.facebookCooldownMinutes || DEFAULT_SETTINGS.facebookCooldownMinutes;
  els.facebookCaption.value = settings.facebookCaption || DEFAULT_SETTINGS.facebookCaption;
  els.facebookCommentPostUrls.value = settings.facebookCommentPostUrls || '';
  els.facebookCommentMode.value = settings.facebookCommentMode || DEFAULT_SETTINGS.facebookCommentMode;
  els.profileId.value = settings.profileId || DEFAULT_SETTINGS.profileId;
  els.profileName.value = settings.profileName || DEFAULT_SETTINGS.profileName;
  els.enabled.checked = Boolean(settings.enabled);
  getSubIdInputs().forEach((input, index) => {
    input.value = settings.subIds?.[index] || '';
  });
  await checkServer();
  await loadLatestAiDiagnostic();
  await refreshJobs();
  renderApiDocs();
  setInterval(refreshJobs, 5000);
}

async function saveSettings() {
  settings = {
    apiBase: els.apiBase.value.trim() || DEFAULT_SETTINGS.apiBase,
    apiToken: els.apiToken.value.trim() || DEFAULT_SETTINGS.apiToken,
    affiliateUrl: els.affiliateUrl.value.trim() || DEFAULT_SETTINGS.affiliateUrl,
    facebookTargetUrl: els.settingsFacebookTargetUrl.value.trim() || els.facebookTargetUrl.value.trim(),
    facebookPublisherEnabled: els.facebookPublisherEnabled.checked,
    facebookProfileId: normalizeProfileId(els.facebookProfileId.value) || DEFAULT_SETTINGS.facebookProfileId,
    facebookProfileName: els.facebookProfileName.value.trim() || els.facebookProfileId.value.trim() || DEFAULT_SETTINGS.facebookProfileName,
    facebookPublishMode: els.facebookPublishMode.value || DEFAULT_SETTINGS.facebookPublishMode,
    facebookCooldownMinutes: Number(els.facebookCooldownMinutes.value) || DEFAULT_SETTINGS.facebookCooldownMinutes,
    facebookCaption: els.facebookCaption.value || DEFAULT_SETTINGS.facebookCaption,
    facebookCommentPostUrls: els.facebookCommentPostUrls.value.trim(),
    facebookCommentMode: els.facebookCommentMode.value || DEFAULT_SETTINGS.facebookCommentMode,
    profileId: normalizeProfileId(els.profileId.value) || DEFAULT_SETTINGS.profileId,
    profileName: els.profileName.value.trim() || els.profileId.value.trim() || DEFAULT_SETTINGS.profileName,
    enabled: els.enabled.checked,
    subIds: getSubIds(),
  };
  await chrome.storage.local.set(settings);
  toast('Settings saved.');
  closeSettings();
}

async function checkServer() {
  try {
    await api('/health');
    els.serverStatus.textContent = 'Server online';
    els.serverStatus.className = 'pill online';
  } catch (error) {
    els.serverStatus.textContent = `Offline: ${error.message}`;
    els.serverStatus.className = 'pill offline';
  }
}

async function loadLatestAiDiagnostic() {
  try {
    const response = await api('/api/ai/diagnostics/latest?limit=1');
    if (response.latest) renderAiDiagnostic(response.latest);
  } catch {
    renderAiDiagnostic({
      analysis: {
        status: 'needs_attention',
        issues: ['Chưa có AI diagnostic hoặc server chưa hỗ trợ endpoint mới.'],
        actions: ['Reload server/extension rồi chạy Diagnose.'],
      },
    });
  }
}

async function runAiTool(repair) {
  els.aiStatus.textContent = repair ? 'Fixing' : 'Checking';
  els.aiStatus.className = 'pill';
  els.aiSummary.textContent = repair ? 'Running auto-fix across open Shopee tabs...' : 'Collecting extension diagnostics...';
  const response = await chrome.runtime.sendMessage({
    type: repair ? 'run-ai-fix' : 'run-ai-diagnostics',
    symptoms: repair ? ['buttons_not_visible', 'extension_not_working'] : ['manual_check'],
  });
  if (!response?.ok) {
    renderAiDiagnostic({
      analysis: {
        status: 'needs_attention',
        issues: [response?.error || 'AI tool failed.'],
        actions: ['Reload shopeeAI extension and try again.'],
      },
    });
    return;
  }
  renderAiDiagnostic(response.result);
  await navigator.clipboard.writeText(JSON.stringify(response.result, null, 2)).catch(() => {});
  toast(repair ? 'AI fix report copied.' : 'Diagnostic report copied.');
}

function renderAiDiagnostic(report) {
  const analysis = report?.analysis || {};
  const issues = analysis.issues || [];
  const actions = analysis.actions || [];
  const status = analysis.status || 'idle';
  els.aiStatus.textContent = status === 'ok' ? 'OK' : status === 'idle' ? 'Idle' : 'Needs attention';
  els.aiStatus.className = status === 'ok' ? 'pill online' : status === 'idle' ? 'pill' : 'pill offline';
  els.aiSummary.innerHTML = `
    <div class="ai-columns">
      <section>
        <h3>Issues</h3>
        ${issues.map((issue) => `<p>${escapeHtml(issue)}</p>`).join('') || '<p>No issues found.</p>'}
      </section>
      <section>
        <h3>Actions</h3>
        ${actions.map((action) => `<p>${escapeHtml(action)}</p>`).join('') || '<p>No action needed.</p>'}
      </section>
      <section>
        <h3>Tabs</h3>
        <p>${escapeHtml((report?.checks?.shopeeTabs || []).length)} Shopee tabs checked.</p>
        <p>Extension: ${escapeHtml(report?.extensionVersion || 'unknown')}</p>
      </section>
    </div>
  `;
}

async function createJob() {
  const type = els.jobType.value;
  const body = { type, limit: Number(els.limit.value) || 20 };
  const url = els.jobUrl.value.trim();
  const keyword = els.keyword.value.trim();
  const subIds = getSubIds();
  const targetProfileId = normalizeProfileId(els.targetProfileId.value);
  if (targetProfileId) body.targetProfileId = targetProfileId;

  if (type === 'facebook-post') {
    const response = await createFacebookJob({
      type: 'facebook-publish-post',
      affiliateLink: url,
      caption: renderCaptionTemplate({}, url),
    });
    toast(`Created Facebook job #${response.job.id}`);
    return;
  }

  if (type === 'facebook-comment') {
    const response = await createFacebookJob({
      type: 'facebook-comment',
      affiliateLink: url,
      caption: renderCaptionTemplate({}, url),
      targetPostUrls: getFacebookCommentPostUrls(),
      commentMode: els.facebookCommentMode.value || settings.facebookCommentMode || 'specific',
    });
    toast(`Created Facebook comment job #${response.job.id}`);
    return;
  }

  if (type === 'product-links') {
    if (url) body.url = url;
    if (keyword) body.keyword = keyword;
  } else if (type === 'affiliate-links') {
    body.links = url.split(/\n+/).map((row) => row.trim()).filter(Boolean);
    addSubIdsToBody(body, subIds);
  } else {
    body.url = url;
    addSubIdsToBody(body, subIds);
  }

  const endpoint = type === 'affiliate-links' && body.links?.length > 5
    ? '/api/shopee/extension/affiliate-links/batch'
    : '/api/shopee/extension/jobs';
  const response = await api(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  toast(response.jobs ? `Created ${response.jobs.length} jobs.` : `Created job #${response.job.id}`);
  await refreshJobs();
}

async function createFacebookJobFromSelected() {
  if (!selectedJob) return toast('Select a product-affiliate job first.');
  const product = getProductFromJob(selectedJob);
  const affiliateLink = getAffiliateLinkFromJob(selectedJob);
  if (!affiliateLink) return toast('No affiliate link found.');
  const response = await createFacebookJob({
    type: 'facebook-publish-post',
    affiliateLink,
    caption: renderCaptionTemplate(product, affiliateLink),
    productKey: product?.shopId && product?.itemId ? `${product.shopId}.${product.itemId}` : '',
    media: getProductImages(product).slice(0, 4),
  });
  toast(`Created Facebook job #${response.job.id}`);
}

async function createFacebookWrapJobFromSelected() {
  if (!selectedJob) return toast('Select a product-affiliate job first.');
  const product = getProductFromJob(selectedJob);
  const affiliateLink = getAffiliateLinkFromJob(selectedJob);
  if (!affiliateLink) return toast('No affiliate link found.');
  const response = await createFacebookJob({
    type: 'facebook-publish-post',
    affiliateLink,
    caption: renderCaptionTemplate(product, affiliateLink),
    productKey: product?.shopId && product?.itemId ? `${product.shopId}.${product.itemId}` : '',
    media: getProductImages(product).slice(0, 4),
    wrapMode: true,
  });
  toast(`Created Facebook wrap job #${response.job.id}`);
  await refreshJobs();
}

async function createFacebookJob({
  type = 'facebook-publish-post',
  affiliateLink = '',
  caption,
  productKey = '',
  media = [],
  targetPostUrls = [],
  commentMode = 'specific',
  wrapMode = false,
}) {
  const targetUrl = els.facebookTargetUrl.value.trim() || settings.facebookTargetUrl;
  if (type !== 'facebook-comment' && !targetUrl) throw new Error('Facebook target URL is required.');
  if (type !== 'facebook-comment' && !affiliateLink) throw new Error('Affiliate link is required.');
  if (type === 'facebook-comment' && !targetPostUrls.length) throw new Error('At least one Facebook post URL is required.');
  return api('/api/social/facebook/jobs', {
    method: 'POST',
    body: JSON.stringify({
      type,
      targetUrl,
      affiliateLink,
      caption,
      commentText: type === 'facebook-comment' ? caption : undefined,
      targetPostUrls,
      commentMode,
      media,
      productKey,
      wrapMode,
      publishMode: els.facebookPublishMode.value || settings.facebookPublishMode || 'draft',
      schedule: {
        cooldownMinutes: Number(els.facebookCooldownMinutes.value) || settings.facebookCooldownMinutes || 45,
      },
    }),
  });
}

function getFacebookCommentPostUrls() {
  return els.facebookCommentPostUrls.value
    .split(/\n+/)
    .map((row) => row.trim())
    .filter(Boolean);
}

function renderCaptionTemplate(product, affiliateLink) {
  const template = els.facebookCaption.value || DEFAULT_SETTINGS.facebookCaption;
  return template
    .replace(/\\n/g, '\n')
    .replaceAll('{name}', product?.name || '')
    .replaceAll('{description}', product?.description || '')
    .replaceAll('{salePrice}', product?.salePrice || product?.price || '')
    .replaceAll('{originalPrice}', product?.originalPrice || '')
    .replaceAll('{discount}', product?.discount || '')
    .replaceAll('{sold}', product?.sold || product?.soldValue || '')
    .replaceAll('{rating}', product?.rating || '')
    .replaceAll('{shopName}', product?.shop?.name || '')
    .replaceAll('{affiliateLink}', affiliateLink || '')
    .replaceAll('{productKey}', product?.shopId && product?.itemId ? `${product.shopId}.${product.itemId}` : '');
}

async function refreshJobs() {
  const [shopeeResponse, facebookResponse] = await Promise.all([
    api('/api/shopee/extension/jobs/created?limit=100'),
    api('/api/social/facebook/jobs?limit=100').catch(() => ({ jobs: [] })),
  ]);
  const shopeeJobs = (shopeeResponse.jobs || []).map((job) => ({ ...job, jobSource: 'shopee' }));
  const facebookJobs = (facebookResponse.jobs || []).map((job) => ({ ...job, jobSource: 'facebook' }));
  allJobs = [...facebookJobs, ...shopeeJobs]
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  renderStats(allJobs);
  renderJobs(allJobs);
  if (selectedJob) {
    const updated = allJobs.find((job) => job.id === selectedJob.id && job.jobSource === selectedJob.jobSource);
    if (updated) selectJob(updated);
  }
}

function renderJobs(jobs) {
  const filtered = els.filterStatus.value === 'all'
    ? jobs
    : jobs.filter((job) => job.status === els.filterStatus.value);

  els.jobs.innerHTML = filtered.length
    ? filtered.map(renderJob).join('')
    : '<div class="result-summary">No jobs yet.</div>';

  els.jobs.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.id;
      const action = button.dataset.action;
      const job = allJobs.find((row) => row.id === id);
      if (action === 'view') selectJob(job);
      if (action === 'retry') await postJobAction(id, 'retry');
      if (action === 'cancel') await postJobAction(id, 'cancel');
    });
  });
}

function renderStats(jobs) {
  els.statQueued.textContent = jobs.filter((job) => job.status === 'queued').length;
  els.statRunning.textContent = jobs.filter((job) => job.status === 'running').length;
  els.statCompleted.textContent = jobs.filter((job) => job.status === 'completed').length;
  els.statFailed.textContent = jobs.filter((job) => job.status === 'failed').length;
}

function renderJob(job) {
  const title = job.url || job.targetUrl || job.input?.keyword || job.input?.links?.[0] || '';
  const profile = job.targetProfileId ? ` → ${job.targetProfileId}` : job.workerProfileId ? ` · ${job.workerProfileId}` : '';
  const updated = (job.updatedAt || job.createdAt || '').slice(11, 19);
  return `
    <article class="job ${selectedJob?.id === job.id ? 'selected' : ''}">
      <strong>#${escapeHtml(job.id)}</strong>
      <span title="${escapeHtml(profile)}">${escapeHtml(job.jobSource === 'facebook' ? 'fb:' : '')}${escapeHtml(job.type || 'job')}${escapeHtml(profile)}</span>
      <span class="job-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
      <span class="status ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
      <span>${escapeHtml(updated)}</span>
      <span class="job-actions">
        <button class="secondary" data-action="view" data-id="${escapeHtml(job.id)}">View</button>
        <button class="secondary" data-action="retry" data-id="${escapeHtml(job.id)}">Retry</button>
        <button class="secondary" data-action="cancel" data-id="${escapeHtml(job.id)}">Cancel</button>
      </span>
    </article>
  `;
}

function selectJob(job) {
  selectedJob = job;
  els.resultSummary.innerHTML = summarizeJob(job);
  els.resultJson.textContent = JSON.stringify(job.result || job, null, 2);
  renderJobs(allJobs);
}

function summarizeJob(job) {
  const result = job.result || {};
  const product = getProductFromJob(job);
  const linkCollection = result.productLinks;
  const link = result.affiliateLink?.links?.[0]?.shortLink;
  const facebookWrappedLink = getFacebookWrappedLinkFromJob(job);
  const offer = result.affiliateOffer?.bestCommission;
  const images = getProductImages(product);
  const videos = getProductVideos(product);
  const description = product?.description || '';
  return `
    <div class="summary-grid">
      ${summaryField('Job', `#${job.id} ${job.type || ''}`)}
      ${summaryField('Status', job.status)}
      ${summaryField('Worker', job.workerProfileId || job.targetProfileId || 'Any profile')}
      ${summaryField('Updated', job.updatedAt || job.createdAt || '')}
      ${product?.name ? summaryField('Product', product.name, true) : ''}
      ${product?.shop?.name ? summaryField('Shop', product.shop.name) : ''}
      ${product?.salePrice || product?.price ? summaryField('Price', formatMoney(product.salePrice || product.price)) : ''}
      ${product?.sold || product?.soldValue ? summaryField('Sold', product.sold || product.soldValue) : ''}
      ${product?.rating ? summaryField('Rating', product.rating) : ''}
      ${product?.totalRatings || product?.totalReviews ? summaryField('Reviews', product.totalRatings || product.totalReviews) : ''}
      ${product?.revenue ? summaryField('Revenue est.', formatMoney(product.revenue)) : ''}
      ${linkCollection?.count ? summaryField('Product links', linkCollection.count) : ''}
      ${link ? summaryField('Affiliate link', `<a href="${escapeHtml(link)}" target="_blank">${escapeHtml(link)}</a>`, true, false) : ''}
      ${result.facebookPostUrl ? summaryField('Facebook post', `<a href="${escapeHtml(result.facebookPostUrl)}" target="_blank">${escapeHtml(result.facebookPostUrl)}</a>`, true, false) : ''}
      ${facebookWrappedLink ? summaryField('FB Shopee link', `<a href="${escapeHtml(facebookWrappedLink)}" target="_blank">${escapeHtml(facebookWrappedLink)}</a>`, true, false) : ''}
      ${result.commentUrl ? summaryField('Facebook comment', `<a href="${escapeHtml(result.commentUrl)}" target="_blank">${escapeHtml(result.commentUrl)}</a>`, true, false) : ''}
      ${offer ? summaryField('Best commission', `${offer.channelType || ''} ${offer.estimatedCommissionAmount || ''}`, true) : ''}
      ${images.length || videos.length ? summaryField('Media', `${images.length} images · ${videos.length} videos`) : ''}
      ${description ? summaryField('Description', description.slice(0, 700), true) : ''}
      ${images.length ? `<div class="summary-field summary-wide"><span>Images</span><div class="media-strip">${images.slice(0, 16).map((url) => `<img src="${escapeHtml(url)}" alt="">`).join('')}</div></div>` : ''}
      ${job.error ? summaryField('Error', job.error, true) : ''}
    </div>
  `;
}

async function postJobAction(id, action) {
  const job = allJobs.find((row) => row.id === id);
  const endpoint = job?.jobSource === 'facebook'
    ? `/api/social/facebook/jobs/${encodeURIComponent(id)}/${action}`
    : `/api/shopee/extension/jobs/${encodeURIComponent(id)}/${action}`;
  await api(endpoint, { method: 'POST', body: '{}' });
  toast(`${action} job #${id}`);
  await refreshJobs();
}

async function clearJobs(status) {
  await api('/api/shopee/extension/jobs/clear', {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
  toast(`Cleared ${status} jobs.`);
  selectedJob = undefined;
  els.resultSummary.textContent = 'Select a completed job.';
  els.resultJson.textContent = '';
  await refreshJobs();
}

async function copyResult() {
  if (!selectedJob) return;
  await navigator.clipboard.writeText(JSON.stringify(selectedJob.result || selectedJob, null, 2));
  toast('Copied JSON.');
}

async function copyProductLink() {
  const product = getProductFromJob(selectedJob);
  const link = product?.url || selectedJob?.url || selectedJob?.result?.productLinks?.links?.[0]?.url;
  if (!link) return toast('No product link found.');
  await navigator.clipboard.writeText(link);
  toast('Copied product link.');
}

async function copyProductName() {
  const product = getProductFromJob(selectedJob);
  if (!product?.name) return toast('No product name found.');
  await navigator.clipboard.writeText(product.name);
  toast('Copied product name.');
}

async function copyDescription() {
  const product = getProductFromJob(selectedJob);
  if (!product?.description) return toast('No description found.');
  await navigator.clipboard.writeText(product.description);
  toast('Copied description.');
}

async function copyAffiliateLink() {
  const link = getAffiliateLinkFromJob(selectedJob);
  if (!link) return toast('No affiliate link found.');
  await navigator.clipboard.writeText(link);
  toast('Copied affiliate link.');
}

async function copyFacebookWrappedLink() {
  const link = getFacebookWrappedLinkFromJob(selectedJob);
  if (!link) return toast('No Facebook-wrapped Shopee link found.');
  await navigator.clipboard.writeText(link);
  toast('Copied Facebook Shopee link.');
}

function getAffiliateLinkFromJob(job) {
  return job?.result?.affiliateLink?.links?.[0]?.shortLink
    || job?.result?.affiliateLink?.shortLink
    || job?.result?.links?.[0]?.shortLink
    || '';
}

function getFacebookWrappedLinkFromJob(job) {
  return job?.result?.facebookWrappedShopeeLink
    || job?.result?.facebookShopeeLinks?.[0]?.url
    || job?.result?.facebookShopeeLinks?.[0]?.targetUrl
    || '';
}

async function downloadMedia(kind) {
  const product = getProductFromJob(selectedJob);
  const items = kind === 'images'
    ? getProductImages(product)
    : getProductVideos(product).map((video) => video.url || video).filter(Boolean);
  const response = await chrome.runtime.sendMessage({
    type: 'download-media',
    items: items.map((url, index) => ({ url, filename: `${product?.name || 'shopee'}-${kind}-${index + 1}` })),
  });
  toast(response?.ok ? `Queued ${items.length} downloads.` : response?.error || 'Download failed.');
}

function openSettings() {
  document.querySelector('#settingsDrawer').classList.add('open');
  document.querySelector('#settingsDrawer').setAttribute('aria-hidden', 'false');
}

function closeSettings() {
  document.querySelector('#settingsDrawer').classList.remove('open');
  document.querySelector('#settingsDrawer').setAttribute('aria-hidden', 'true');
}

function openApiDocs() {
  renderApiDocs();
  document.querySelector('#apiDocsDrawer').classList.add('open');
  document.querySelector('#apiDocsDrawer').setAttribute('aria-hidden', 'false');
}

function closeApiDocs() {
  document.querySelector('#apiDocsDrawer').classList.remove('open');
  document.querySelector('#apiDocsDrawer').setAttribute('aria-hidden', 'true');
}

function renderApiDocs() {
  els.apiDocsContent.innerHTML = API_DOC_SECTIONS.map((section) => `
    <section class="docs-section">
      <h3>${escapeHtml(section.title)}</h3>
      <p>${escapeHtml(section.text)}</p>
      ${section.endpoints.map(([method, path, description]) => `
        <article class="endpoint">
          <div class="endpoint-head">
            <span class="endpoint-method ${method.toLowerCase()}">${escapeHtml(method)}</span>
            <strong class="endpoint-path">${escapeHtml(path)}</strong>
            <button class="secondary" data-copy-endpoint="${escapeHtml(method)} ${escapeHtml(path)}">Copy</button>
          </div>
          <p>${escapeHtml(description)}</p>
        </article>
      `).join('')}
    </section>
  `).join('');

  els.apiDocsContent.querySelectorAll('[data-copy-endpoint]').forEach((button) => {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(`${settings.apiBase}${button.dataset.copyEndpoint.replace(/^(GET|POST)\s+/, '')}`);
      toast('Copied endpoint URL.');
    });
  });
}

async function copyApiDocs() {
  await navigator.clipboard.writeText(apiDocsMarkdown());
  toast('Copied API docs.');
}

async function copyApiBase() {
  await navigator.clipboard.writeText(settings.apiBase);
  toast('Copied API base.');
}

function apiDocsMarkdown() {
  return [
    '# shopeeAI API Docs',
    '',
    `Base URL: \`${settings.apiBase}\``,
    '',
    'Authentication: `Authorization: Bearer <API_TOKEN>` for every API except `/health`.',
    '',
    ...API_DOC_SECTIONS.flatMap((section) => [
      `## ${section.title}`,
      '',
      section.text,
      '',
      ...section.endpoints.flatMap(([method, path, description]) => [
        `### ${method} ${path}`,
        '',
        description,
        '',
      ]),
    ]),
  ].join('\n');
}

function getProductFromJob(job) {
  const result = job?.result || {};
  if (result.productData) return result.productData;
  if (result.product) return { ...result.product, url: result.url, shopId: result.shopId, itemId: result.itemId };
  if (result.productLinks) return result.productLinks;
  return result;
}

function getProductImages(product) {
  return Array.isArray(product?.images) ? product.images : [];
}

function getProductVideos(product) {
  return Array.isArray(product?.videos) ? product.videos : [];
}

function summaryField(label, value, wide = false, shouldEscape = true) {
  return `
    <div class="summary-field ${wide ? 'summary-wide' : ''}">
      <span>${escapeHtml(label)}</span>
      <strong>${shouldEscape ? escapeHtml(value) : value}</strong>
    </div>
  `;
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return `${number.toLocaleString('vi-VN')}đ`;
}

async function api(path, options = {}) {
  const response = await fetch(`${settings.apiBase}${path}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${settings.apiToken}`,
      'content-type': 'application/json',
    },
    body: options.body,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.style.display = 'block';
  setTimeout(() => {
    els.toast.style.display = 'none';
  }, 2200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getSubIdInputs() {
  return [els.subId1, els.subId2, els.subId3, els.subId4, els.subId5];
}

function getSubIds() {
  return getSubIdInputs().map((input) => input.value.trim());
}

function addSubIdsToBody(body, subIds) {
  subIds.forEach((subId, index) => {
    if (subId) body[`subId${index + 1}`] = subId;
  });
}

function normalizeProfileId(value) {
  return String(value || '').trim().replace(/[^\w.-]+/g, '-').slice(0, 80);
}
