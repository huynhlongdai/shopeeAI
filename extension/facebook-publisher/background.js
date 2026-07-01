const DEFAULT_SETTINGS = {
  apiBase: 'http://127.0.0.1:8787',
  apiToken: 'change-me',
  enabled: true,
  profileId: 'facebook-profile-1',
  profileName: 'Facebook Profile 1',
  defaultTargetUrl: '',
  publishMode: 'draft',
  minCooldownMinutes: 45,
  jitterMinutes: 10,
  maxPostsPerDay: 12,
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...current });
  chrome.alarms.create('pollFacebookJobs', { periodInMinutes: 0.2 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('pollFacebookJobs', { periodInMinutes: 0.2 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollFacebookJobs') {
    pollJobs().catch((error) => setStatus({ state: 'error', message: error.message }));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'poll-now') {
    pollJobs()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'get-status') {
    chrome.storage.local.get({ lastStatus: null, latestJob: null, ...DEFAULT_SETTINGS })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'save-settings') {
    chrome.storage.local.set({ ...message.settings })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'copy-text') {
    navigator.clipboard.writeText(message.text || '')
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function pollJobs() {
  const settings = await getSettings();
  if (!settings.enabled) return { skipped: true };

  const query = new URLSearchParams({
    profileId: settings.profileId,
    profileName: settings.profileName,
    extensionVersion: chrome.runtime.getManifest().version,
  });
  const response = await apiFetch(settings, `/api/social/facebook/jobs/next?${query.toString()}`);
  if (!response.job) {
    await setStatus({ state: 'idle', message: 'No Facebook jobs.' });
    return response;
  }

  const job = applyLocalDefaults(response.job, settings);
  await chrome.storage.local.set({ latestJob: job });
  await setStatus({ state: 'running', message: `Preparing ${job.id}` });
  try {
    const tab = await openTargetTab(job.targetUrl);
    const prepareResponse = await preparePostInTab(tab.id, job);
    if (prepareResponse?.ok === false) {
      throw new Error(prepareResponse.error || 'Facebook content script failed.');
    }
    const publishResult = prepareResponse?.result || prepareResponse || {};

    if (publishResult.completed || publishResult.commented || (publishResult.published && publishResult.facebookPostUrl)) {
      const completeBody = {
        profileId: settings.profileId,
        extensionVersion: chrome.runtime.getManifest().version,
        status: publishResult.status || (publishResult.commented ? 'commented' : 'published'),
        targetUrl: job.targetUrl,
        publishMode: job.publishMode,
        facebookPostUrl: publishResult.facebookPostUrl || '',
        commentUrl: publishResult.commentUrl || '',
        facebookShopeeLinks: publishResult.facebookShopeeLinks || [],
        facebookWrappedShopeeLink: publishResult.facebookWrappedShopeeLink || '',
        note: publishResult.note || 'Facebook post was published by the extension.',
      };
      await apiFetch(settings, `/api/social/facebook/jobs/${encodeURIComponent(job.id)}/complete`, {
        method: 'POST',
        body: JSON.stringify(completeBody),
      });
      await setStatus({ state: 'published', message: `${job.id} published.` });
      return { job, publishResult };
    }

    await apiFetch(settings, `/api/social/facebook/jobs/${encodeURIComponent(job.id)}/ready`, {
      method: 'POST',
      body: JSON.stringify({
        profileId: settings.profileId,
        extensionVersion: chrome.runtime.getManifest().version,
        status: publishResult.status || 'ready_for_publish',
        targetUrl: job.targetUrl,
        publishMode: job.publishMode,
        note: publishResult.note || 'Facebook post panel is ready. Review and publish from the browser.',
      }),
    });
    await setStatus({ state: 'ready', message: `${job.id} ready for publish.` });
    return { job, publishResult };
  } catch (error) {
    await apiFetch(settings, `/api/social/facebook/jobs/${encodeURIComponent(job.id)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ profileId: settings.profileId, extensionVersion: chrome.runtime.getManifest().version, error: error.message }),
    }).catch(() => {});
    await setStatus({ state: 'error', message: error.message });
    throw error;
  }
}

async function preparePostInTab(tabId, job) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return await chrome.tabs.sendMessage(tabId, { type: 'prepare-facebook-post', job });
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return chrome.tabs.sendMessage(tabId, { type: 'prepare-facebook-post', job });
  }
}

function applyLocalDefaults(job, settings) {
  return {
    ...job,
    targetUrl: job.targetUrl || settings.defaultTargetUrl,
    publishMode: job.publishMode || settings.publishMode || 'draft',
  };
}

async function openTargetTab(url) {
  if (!url) throw new Error('Facebook target URL is required.');
  const existing = (await chrome.tabs.query({ url: 'https://www.facebook.com/*' }))
    .find((tab) => tab.url && normalizeUrl(tab.url) === normalizeUrl(url));
  const tab = existing || await chrome.tabs.create({ url, active: true });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.tabs.reload(existing.id);
  }
  await waitForTabComplete(tab.id);
  return chrome.tabs.get(tab.id);
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Facebook tab load timed out.'));
    }, 30000);
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

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
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
  if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function setStatus(status) {
  await chrome.storage.local.set({ lastStatus: { ...status, at: new Date().toISOString() } });
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
