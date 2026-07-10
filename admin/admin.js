const state = {
  token: localStorage.getItem('shopeeai.admin.token') || 'change-me',
  jobs: [],
  selectedJob: null,
};

const els = {
  apiToken: document.querySelector('#apiToken'),
  saveToken: document.querySelector('#saveToken'),
  refreshAll: document.querySelector('#refreshAll'),
  metricQueued: document.querySelector('#metricQueued'),
  metricRunning: document.querySelector('#metricRunning'),
  metricCompleted: document.querySelector('#metricCompleted'),
  metricFailed: document.querySelector('#metricFailed'),
  metricProducts: document.querySelector('#metricProducts'),
  metricProfiles: document.querySelector('#metricProfiles'),
  jobType: document.querySelector('#jobType'),
  jobUrl: document.querySelector('#jobUrl'),
  keyword: document.querySelector('#keyword'),
  limit: document.querySelector('#limit'),
  mode: document.querySelector('#mode'),
  maxPages: document.querySelector('#maxPages'),
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
  createJob: document.querySelector('#createJob'),
  createBatch: document.querySelector('#createBatch'),
  filterStatus: document.querySelector('#filterStatus'),
  refreshJobs: document.querySelector('#refreshJobs'),
  jobsList: document.querySelector('#jobsList'),
  resultSummary: document.querySelector('#resultSummary'),
  resultJson: document.querySelector('#resultJson'),
  copyJson: document.querySelector('#copyJson'),
  copyName: document.querySelector('#copyName'),
  copyDescription: document.querySelector('#copyDescription'),
  copyProductLink: document.querySelector('#copyProductLink'),
  copyAffiliateLink: document.querySelector('#copyAffiliateLink'),
  copyFacebookTrackedLink: document.querySelector('#copyFacebookTrackedLink'),
  downloadImages: document.querySelector('#downloadImages'),
  downloadVideos: document.querySelector('#downloadVideos'),
  profileGrid: document.querySelector('#profileGrid'),
  batchList: document.querySelector('#batchList'),
  agentApiBase: document.querySelector('#agentApiBase'),
  agentAuthHeader: document.querySelector('#agentAuthHeader'),
  agentPrompt: document.querySelector('#agentPrompt'),
  agentEndpointList: document.querySelector('#agentEndpointList'),
  agentManifestJson: document.querySelector('#agentManifestJson'),
  copyAgentContext: document.querySelector('#copyAgentContext'),
  copyCurlPack: document.querySelector('#copyCurlPack'),
  loadAgentManifest: document.querySelector('#loadAgentManifest'),
  toast: document.querySelector('#toast'),
};

init();

function init() {
  els.apiToken.value = state.token;
  els.saveToken.addEventListener('click', saveToken);
  els.refreshAll.addEventListener('click', refreshAll);
  els.refreshJobs.addEventListener('click', refreshJobs);
  els.filterStatus.addEventListener('change', renderJobs);
  els.createJob.addEventListener('click', () => createJob(false));
  els.createBatch.addEventListener('click', () => createJob(true));
  els.copyJson.addEventListener('click', () => copyText(els.resultJson.textContent));
  els.copyName.addEventListener('click', () => copyText(getSelectedProduct()?.name || ''));
  els.copyDescription.addEventListener('click', () => copyText(getSelectedProduct()?.description || ''));
  els.copyProductLink.addEventListener('click', () => copyText(getSelectedProductUrl()));
  els.copyAffiliateLink.addEventListener('click', () => copyText(getAffiliateLink(state.selectedJob)));
  els.copyFacebookTrackedLink.addEventListener('click', () => copyText(getFacebookTrackedLink(state.selectedJob)));
  els.downloadImages.addEventListener('click', () => downloadMedia('images'));
  els.downloadVideos.addEventListener('click', () => downloadMedia('videos'));
  els.copyAgentContext.addEventListener('click', () => copyText(buildAgentContext()));
  els.copyCurlPack.addEventListener('click', () => copyText(buildCurlPack()));
  els.loadAgentManifest.addEventListener('click', loadAgentManifest);
  renderAgentOps();
  refreshAll();
  setInterval(refreshAll, 10000);
}

function saveToken() {
  state.token = els.apiToken.value.trim();
  localStorage.setItem('shopeeai.admin.token', state.token);
  toast('Token saved.');
  renderAgentOps();
  refreshAll();
}

async function refreshAll() {
  await Promise.allSettled([refreshOverview(), refreshJobs()]);
}

async function refreshOverview() {
  const overview = await api('/api/admin/overview');
  els.metricQueued.textContent = overview.totals?.queued || 0;
  els.metricRunning.textContent = overview.totals?.running || 0;
  els.metricCompleted.textContent = overview.totals?.completed || 0;
  els.metricFailed.textContent = overview.totals?.failed || 0;
  els.metricProducts.textContent = overview.cache?.products || 0;
  els.metricProfiles.textContent = overview.totals?.profiles || 0;
  renderProfiles([...(overview.profiles || []), ...(overview.facebookProfiles || [])]);
  renderBatches(overview.batches || []);
  renderAgentOps(overview);
}

async function refreshJobs() {
  const status = els.filterStatus.value;
  const statusQuery = status === 'all' ? '' : `&status=${encodeURIComponent(status)}`;
  const [shopee, facebook] = await Promise.all([
    api(`/api/shopee/extension/jobs/created?limit=120&light=1${statusQuery}`),
    api(`/api/social/facebook/jobs?limit=80&light=1${statusQuery}`).catch(() => ({ jobs: [] })),
  ]);
  state.jobs = [...(shopee.jobs || []), ...(facebook.jobs || [])]
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  renderJobs();
}

function renderJobs() {
  if (!state.jobs.length) {
    els.jobsList.innerHTML = '<div class="empty-state">No jobs found.</div>';
    return;
  }
  els.jobsList.innerHTML = state.jobs.map((job) => `
    <article class="job-row ${state.selectedJob?.id === job.id && state.selectedJob?.source === job.source ? 'selected' : ''}">
      <strong>#${escapeHtml(job.id)}</strong>
      <span>${escapeHtml(job.source || '')}</span>
      <span class="truncate" title="${escapeHtml(job.type || '')}">${escapeHtml(job.type || '')}</span>
      <span class="truncate" title="${escapeHtml(job.target || job.url || '')}">${escapeHtml(job.resultPreview?.name || job.target || job.url || '')}</span>
      <span class="status ${escapeHtml(job.status || '')}">${escapeHtml(job.status || '')}</span>
      <button class="ghost" data-view="${escapeHtml(job.source)}:${escapeHtml(job.id)}">View</button>
    </article>
  `).join('');
  els.jobsList.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const [source, id] = button.dataset.view.split(':');
      selectJob(source, id);
    });
  });
}

async function selectJob(source, id) {
  const path = source === 'facebook'
    ? `/api/social/facebook/jobs/${encodeURIComponent(id)}`
    : `/api/shopee/extension/jobs/${encodeURIComponent(id)}`;
  const response = await api(path);
  state.selectedJob = { ...(response.job || {}), source };
  renderJobs();
  renderResult(state.selectedJob);
}

function renderResult(job) {
  const product = getProductFromJob(job);
  const images = getProductMedia(product, 'images');
  const videos = getProductMedia(product, 'videos');
  const offer = getAffiliateOffer(job);
  const bestCommission = offer?.bestCommission || {};
  const fields = [
    ['Job', `#${job.id} ${job.type || ''}`],
    ['Status', job.status || ''],
    ['Product', product?.name || job.result?.facebookPostUrl || job.targetUrl || '', true],
    ['Shop', product?.shop?.name || ''],
    ['Price', formatMoney(product?.salePrice || product?.price)],
    ['Sold', product?.sold || ''],
    ['Rating', product?.rating || ''],
    ['Commission rate', offer?.commissionRate || bestCommission.sellerCommission || bestCommission.shopeeCommission || ''],
    ['Commission amount', offer?.commission || bestCommission.estimatedCommissionAmount || ''],
    ['Offer status', offer?.status || (offer?.available === false ? 'Unavailable' : '')],
    ['Output link', getFacebookOutputLink(job), true],
    ['Affiliate', getAffiliateLink(job), true],
    ['Facebook post', job.result?.facebookPostUrl || '', true],
    ['Visible Shopee link', job.result?.visibleShopeeLink || '', true],
    ['Facebook tracked link', getFacebookTrackedLink(job), true],
    ['FB Shopee link', job.result?.facebookWrappedShopeeLink || '', true],
    ['Description', product?.description || '', true],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');

  els.resultSummary.innerHTML = `
    <div class="summary-grid">
      ${fields.map(([label, value, wide]) => summaryField(label, value, wide)).join('')}
      ${images.length ? `<div class="summary-card wide"><span>Images</span><div class="media-strip">${images.slice(0, 18).map((url) => `<img src="${escapeHtml(url)}" alt="">`).join('')}</div></div>` : ''}
      ${videos.length ? summaryField('Videos', `${videos.length} available`, true) : ''}
      ${job.error ? summaryField('Error', job.error, true) : ''}
    </div>
  `;
  els.resultJson.textContent = JSON.stringify(job.result || job, null, 2);
}

async function createJob(forceBatch) {
  const type = els.jobType.value;
  const links = getLines(els.jobUrl.value);
  const body = buildJobBody(type, links);
  let path = '/api/shopee/extension/jobs';

  if (type === 'facebook-post' || type === 'facebook-comment') {
    path = '/api/social/facebook/jobs';
  } else if (forceBatch && type === 'product-affiliate') {
    path = '/api/shopee/extension/product-affiliate-batch';
  } else if (forceBatch && type === 'affiliate-links') {
    path = '/api/shopee/extension/affiliate-links/batch';
  } else if (type === 'product-affiliate' && els.mode.value === 'fast') {
    path = '/api/shopee/extension/product-affiliate-fast';
  } else if (type === 'product-affiliate') {
    path = '/api/shopee/extension/product-affiliate';
  } else if (type === 'affiliate-offer') {
    path = '/api/shopee/extension/affiliate-offer';
  } else if (type === 'product-info') {
    path = '/api/shopee/extension/product-info';
  } else if (type === 'product-links') {
    path = '/api/shopee/extension/product-links';
  } else if (type === 'affiliate-links') {
    path = links.length > 5 ? '/api/shopee/extension/affiliate-links/batch' : '/api/shopee/extension/affiliate-links';
  }

  await api(path, { method: 'POST', body });
  toast(forceBatch ? 'Batch created.' : 'Job created.');
  await refreshAll();
}

function buildJobBody(type, links) {
  const subIds = getSubIds();
  const body = {
    type,
    url: links[0] || els.jobUrl.value.trim(),
    links,
    keyword: els.keyword.value.trim(),
    limit: Number(els.limit.value) || 20,
    maxPages: Number(els.maxPages.value) || 1,
    mode: els.mode.value,
    targetProfileId: els.targetProfileId.value.trim(),
    subIds,
    subId1: subIds[0],
    subId2: subIds[1],
    subId3: subIds[2],
    subId4: subIds[3],
    subId5: subIds[4],
  };

  if (type === 'facebook-post' || type === 'facebook-comment') {
    body.type = type;
    body.targetUrl = els.facebookTargetUrl.value.trim() || links[0] || '';
    body.affiliateLink = links.find((link) => /shopee|s\.shopee/i.test(link)) || '';
    body.caption = els.facebookCaption.value.trim() || body.affiliateLink;
    body.commentText = body.caption;
    body.publishMode = els.facebookPublishMode.value;
    body.cooldownMinutes = Number(els.facebookCooldownMinutes.value) || 45;
  }

  return body;
}

function renderProfiles(profiles) {
  els.profileGrid.innerHTML = profiles.length
    ? profiles.map((profile) => `
      <article class="profile-card">
        <strong>${escapeHtml(profile.profileName || profile.profileId)}</strong>
        <span>${escapeHtml(profile.profileId || '')}</span>
        <span class="status ${escapeHtml(profile.state || '')}">${escapeHtml(profile.state || 'online')}</span>
        <span>Success ${Number(profile.successCount) || 0} | Errors ${Number(profile.errorCount) || 0}</span>
        ${profile.currentJobId ? `<span>Current #${escapeHtml(profile.currentJobId)}</span>` : ''}
      </article>
    `).join('')
    : '<div class="empty-state">No connected profiles yet.</div>';
}

function renderBatches(batches) {
  els.batchList.innerHTML = batches.length
    ? batches.map((batch) => `
      <article class="batch-card">
        <strong>${escapeHtml(batch.id)}</strong>
        <span>${escapeHtml(batch.status || '')}</span>
        <span>${Number(batch.progress?.done || 0)} / ${Number(batch.total || 0)} done</span>
        <span>${Number(batch.cachedCount || 0)} cached | ${Number(batch.jobCount || 0)} jobs</span>
      </article>
    `).join('')
    : '<div class="empty-state">No batches yet.</div>';
}

function renderAgentOps(overview = {}) {
  const base = location.origin;
  els.agentApiBase.textContent = base;
  els.agentAuthHeader.textContent = state.token
    ? `authorization: Bearer ${maskToken(state.token)}`
    : 'authorization: Bearer <API_TOKEN>';
  els.agentPrompt.value = buildAgentContext(overview);
  els.agentEndpointList.innerHTML = agentEndpointRows().map((row) => `
    <article class="endpoint-row">
      <span class="endpoint-method ${row.method.toLowerCase()}">${escapeHtml(row.method)}</span>
      <code>${escapeHtml(row.path)}</code>
      <strong>${escapeHtml(row.label)}</strong>
    </article>
  `).join('');
}

async function loadAgentManifest() {
  const manifest = await api('/api/agent/manifest');
  els.agentManifestJson.textContent = JSON.stringify(manifest, null, 2);
  toast('Agent manifest loaded.');
}

function buildAgentContext(overview = {}) {
  const base = location.origin;
  const token = state.token || '<API_TOKEN>';
  const profiles = [
    ...(overview.profiles || []),
    ...(overview.facebookProfiles || []),
  ].map((profile) => profile.profileId).filter(Boolean);
  return [
    '# shopeeAI Agent Handoff',
    '',
    `API Base: ${base}`,
    `Authorization header: authorization: Bearer ${token}`,
    `Admin UI: ${base}/admin/`,
    `Manifest JSON: ${base}/api/agent/manifest`,
    '',
    'Operating model:',
    '- The server owns queue, cache, API, admin UI, and results.',
    '- Chrome extension profiles are workers. They must be online and logged into Shopee/Shopee Affiliate/Facebook.',
    '- Do not scrape Shopee from a fresh server browser when an extension worker is available.',
    '',
    'Before creating jobs:',
    `1. GET ${base}/health should return {"ok":true}.`,
    `2. GET ${base}/api/shopee/extension/profiles should show at least one online worker.`,
    `3. Current known worker profiles: ${profiles.length ? profiles.join(', ') : 'none yet'}.`,
    '',
    'Recommended Shopee product flow:',
    '1. POST /api/shopee/extension/product-affiliate or /product-affiliate-fast with { url, subId1, targetProfileId? }.',
    '2. Poll GET /api/shopee/extension/jobs/:id until terminal status.',
    '3. Read result.productData, result.affiliateOffer, result.affiliateLink.',
    '',
    'Recommended Facebook wrap flow:',
    '1. Create affiliate link first.',
    '2. POST /api/social/facebook/jobs with publishMode=auto and wrapMode=true.',
    '3. Poll GET /api/social/facebook/jobs/:id.',
    '4. Return result.outputLink first; fallback to result.primaryLink, then facebookPostUrl only for debug.',
    '',
    'Terminal statuses: completed, published, commented, failed, cancelled, published_pending_url.',
  ].join('\n');
}

function buildCurlPack() {
  const base = location.origin;
  const token = state.token || '<API_TOKEN>';
  return [
    `curl -i ${base}/health`,
    '',
    `curl -s ${base}/api/agent/manifest \\`,
    `  -H 'authorization: Bearer ${token}'`,
    '',
    `curl -s ${base}/api/shopee/extension/profiles \\`,
    `  -H 'authorization: Bearer ${token}'`,
    '',
    `curl -s -X POST ${base}/api/shopee/extension/product-affiliate \\`,
    `  -H 'content-type: application/json' \\`,
    `  -H 'authorization: Bearer ${token}' \\`,
    `  -d '{"url":"https://shopee.vn/product-name-i.123.456","subId1":"agent"}'`,
    '',
    `curl -s ${base}/api/shopee/extension/jobs/<JOB_ID> \\`,
    `  -H 'authorization: Bearer ${token}'`,
    '',
    `curl -s -X POST ${base}/api/social/facebook/jobs \\`,
    `  -H 'content-type: application/json' \\`,
    `  -H 'authorization: Bearer ${token}' \\`,
    `  -d '{"type":"facebook-publish-post","targetUrl":"https://www.facebook.com/<page>","affiliateLink":"https://s.shopee.vn/<id>","caption":"Link mua: https://s.shopee.vn/<id>","publishMode":"auto","wrapMode":true}'`,
  ].join('\n');
}

function agentEndpointRows() {
  return [
    { method: 'GET', path: '/health', label: 'Server liveness' },
    { method: 'GET', path: '/api/agent/manifest', label: 'Machine-readable agent manifest' },
    { method: 'GET', path: '/api/admin/overview', label: 'Queue/cache/profile summary' },
    { method: 'GET', path: '/api/shopee/extension/profiles', label: 'Online Chrome workers' },
    { method: 'POST', path: '/api/shopee/extension/product-affiliate', label: 'Product + commission + affiliate job' },
    { method: 'POST', path: '/api/shopee/extension/product-affiliate-batch', label: 'Batch product affiliate jobs' },
    { method: 'POST', path: '/api/shopee/extension/affiliate-links/batch', label: 'Batch link conversion' },
    { method: 'GET', path: '/api/shopee/extension/jobs/:id', label: 'Shopee job result' },
    { method: 'POST', path: '/api/social/facebook/jobs', label: 'Facebook publish/comment/wrap job' },
    { method: 'GET', path: '/api/social/facebook/jobs/:id', label: 'Facebook job result' },
  ];
}

function maskToken(token) {
  const text = String(token || '');
  if (text.length <= 10) return text ? 'saved' : '<API_TOKEN>';
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function getLines(value) {
  return String(value || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getSubIds() {
  return [els.subId1, els.subId2, els.subId3, els.subId4, els.subId5].map((input) => input.value.trim());
}

function getProductFromJob(job = state.selectedJob) {
  const result = job?.result || {};
  const productData = result.productData || result.product || result;
  return productData.product || productData;
}

function getSelectedProduct() {
  return getProductFromJob(state.selectedJob);
}

function getSelectedProductUrl() {
  const product = getSelectedProduct();
  return product?.url || state.selectedJob?.url || state.selectedJob?.result?.productData?.url || '';
}

function getAffiliateLink(job = state.selectedJob) {
  const result = job?.result || {};
  return result.affiliateLink?.links?.[0]?.shortLink
    || result.affiliateLink?.shortLink
    || result.links?.[0]?.shortLink
    || result.facebookWrappedShopeeLink
    || '';
}

function getFacebookTrackedLink(job = state.selectedJob) {
  const result = job?.result || {};
  return result.outputLink && result.linkType === 'facebook_wrapped_shopee_link'
    ? result.outputLink
    : result.facebookTrackedShopeeLink
    || result.facebookWrappedShopeeLink
    || result.facebookShopeeLinks?.[0]?.facebookTrackedShopeeLink
    || result.facebookShopeeLinks?.[0]?.url
    || '';
}

function getFacebookOutputLink(job = state.selectedJob) {
  const result = job?.result || {};
  return result.outputLink || result.primaryLink || '';
}

function getAffiliateOffer(job = state.selectedJob) {
  const result = job?.result || {};
  if (result.affiliateOffer) return result.affiliateOffer;
  if (result.offerId || result.commissionRate || result.bestCommission || result.available !== undefined) return result;
  return undefined;
}

function getProductMedia(product, key) {
  const rows = Array.isArray(product?.[key]) ? product[key] : [];
  return rows
    .map((item) => typeof item === 'string' ? item : item.url || item.thumbnail || '')
    .filter(Boolean);
}

function downloadMedia(key) {
  const urls = getProductMedia(getSelectedProduct(), key);
  if (!urls.length) {
    toast(`No ${key} to download.`);
    return;
  }
  urls.forEach((url, index) => {
    setTimeout(() => {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `shopeeai-${key}-${index + 1}`;
      anchor.target = '_blank';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    }, index * 120);
  });
}

function summaryField(label, value, wide) {
  return `
    <div class="summary-card ${wide ? 'wide' : ''}">
      <span>${escapeHtml(label)}</span>
      <strong>${linkify(value)}</strong>
    </div>
  `;
}

function linkify(value) {
  const text = String(value || '');
  if (/^https?:\/\//i.test(text)) {
    return `<a href="${escapeHtml(text)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`;
  }
  return escapeHtml(text);
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return value || '';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(number);
}

async function copyText(value) {
  if (!value) {
    toast('Nothing to copy.');
    return;
  }
  await navigator.clipboard.writeText(String(value));
  toast('Copied.');
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.style.display = 'none';
  }, 1800);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
