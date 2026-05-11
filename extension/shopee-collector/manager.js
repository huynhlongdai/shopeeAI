const DEFAULT_SETTINGS = {
  apiBase: 'http://127.0.0.1:8787',
  apiToken: 'change-me',
  affiliateUrl: 'https://affiliate.shopee.vn/offer/custom_link',
  enabled: true,
  subIds: ['n8n', '', '', '', ''],
  profileId: 'profile-1',
  profileName: 'Profile 1',
};

let settings;
let selectedJob;
let allJobs = [];

const els = {
  apiBase: document.querySelector('#apiBase'),
  apiToken: document.querySelector('#apiToken'),
  affiliateUrl: document.querySelector('#affiliateUrl'),
  profileId: document.querySelector('#profileId'),
  profileName: document.querySelector('#profileName'),
  enabled: document.querySelector('#enabled'),
  serverStatus: document.querySelector('#serverStatus'),
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
  filterStatus: document.querySelector('#filterStatus'),
  statQueued: document.querySelector('#statQueued'),
  statRunning: document.querySelector('#statRunning'),
  statCompleted: document.querySelector('#statCompleted'),
  statFailed: document.querySelector('#statFailed'),
  jobs: document.querySelector('#jobs'),
  resultSummary: document.querySelector('#resultSummary'),
  resultJson: document.querySelector('#resultJson'),
  toast: document.querySelector('#toast'),
};

init();

document.querySelector('#saveSettings').addEventListener('click', saveSettings);
document.querySelector('#checkServer').addEventListener('click', checkServer);
document.querySelector('#createJob').addEventListener('click', createJob);
document.querySelector('#runQueue').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'poll-now' }).then(refreshJobs));
document.querySelector('#openSettings').addEventListener('click', openSettings);
document.querySelector('#closeSettings').addEventListener('click', closeSettings);
document.querySelector('#closeSettingsButton').addEventListener('click', closeSettings);
document.querySelector('#refreshJobs').addEventListener('click', refreshJobs);
document.querySelector('#clearCompleted').addEventListener('click', () => clearJobs('completed'));
document.querySelector('#copyResult').addEventListener('click', copyResult);
document.querySelector('#copyProductName').addEventListener('click', copyProductName);
document.querySelector('#copyDescription').addEventListener('click', copyDescription);
document.querySelector('#copyProductLink').addEventListener('click', copyProductLink);
document.querySelector('#copyAffiliateLink').addEventListener('click', copyAffiliateLink);
document.querySelector('#downloadImages').addEventListener('click', () => downloadMedia('images'));
document.querySelector('#downloadVideos').addEventListener('click', () => downloadMedia('videos'));
els.filterStatus.addEventListener('change', () => renderJobs(allJobs));

async function init() {
  settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  els.apiBase.value = settings.apiBase;
  els.apiToken.value = settings.apiToken;
  els.affiliateUrl.value = settings.affiliateUrl;
  els.profileId.value = settings.profileId || DEFAULT_SETTINGS.profileId;
  els.profileName.value = settings.profileName || DEFAULT_SETTINGS.profileName;
  els.enabled.checked = Boolean(settings.enabled);
  getSubIdInputs().forEach((input, index) => {
    input.value = settings.subIds?.[index] || '';
  });
  await checkServer();
  await refreshJobs();
  setInterval(refreshJobs, 5000);
}

async function saveSettings() {
  settings = {
    apiBase: els.apiBase.value.trim() || DEFAULT_SETTINGS.apiBase,
    apiToken: els.apiToken.value.trim() || DEFAULT_SETTINGS.apiToken,
    affiliateUrl: els.affiliateUrl.value.trim() || DEFAULT_SETTINGS.affiliateUrl,
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

async function createJob() {
  const type = els.jobType.value;
  const body = { type, limit: Number(els.limit.value) || 20 };
  const url = els.jobUrl.value.trim();
  const keyword = els.keyword.value.trim();
  const subIds = getSubIds();
  const targetProfileId = normalizeProfileId(els.targetProfileId.value);
  if (targetProfileId) body.targetProfileId = targetProfileId;

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

  const response = await api('/api/shopee/extension/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  toast(`Created job #${response.job.id}`);
  await refreshJobs();
}

async function refreshJobs() {
  const response = await api('/api/shopee/extension/jobs/created?limit=100');
  allJobs = response.jobs || [];
  renderStats(allJobs);
  renderJobs(allJobs);
  if (selectedJob) {
    const updated = allJobs.find((job) => job.id === selectedJob.id);
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
  const title = job.url || job.input?.keyword || job.input?.links?.[0] || '';
  const profile = job.targetProfileId ? ` → ${job.targetProfileId}` : job.workerProfileId ? ` · ${job.workerProfileId}` : '';
  const updated = (job.updatedAt || job.createdAt || '').slice(11, 19);
  return `
    <article class="job ${selectedJob?.id === job.id ? 'selected' : ''}">
      <strong>#${escapeHtml(job.id)}</strong>
      <span title="${escapeHtml(profile)}">${escapeHtml(job.type || 'job')}${escapeHtml(profile)}</span>
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
      ${offer ? summaryField('Best commission', `${offer.channelType || ''} ${offer.estimatedCommissionAmount || ''}`, true) : ''}
      ${images.length || videos.length ? summaryField('Media', `${images.length} images · ${videos.length} videos`) : ''}
      ${description ? summaryField('Description', description.slice(0, 700), true) : ''}
      ${images.length ? `<div class="summary-field summary-wide"><span>Images</span><div class="media-strip">${images.slice(0, 16).map((url) => `<img src="${escapeHtml(url)}" alt="">`).join('')}</div></div>` : ''}
      ${job.error ? summaryField('Error', job.error, true) : ''}
    </div>
  `;
}

async function postJobAction(id, action) {
  await api(`/api/shopee/extension/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' });
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
  const link = selectedJob?.result?.affiliateLink?.links?.[0]?.shortLink;
  if (!link) return toast('No affiliate link found.');
  await navigator.clipboard.writeText(link);
  toast('Copied affiliate link.');
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
