const DEFAULT_SETTINGS = {
  apiBase: 'http://127.0.0.1:8787',
  apiToken: 'change-me',
  enabled: true,
  profileId: 'facebook-profile-1',
  profileName: 'Facebook Profile 1',
  defaultTargetUrl: '',
  publishMode: 'draft',
};

const ids = ['apiBase', 'apiToken', 'profileId', 'profileName', 'defaultTargetUrl', 'publishMode', 'enabled'];
const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const statusEl = document.getElementById('status');

init();

document.getElementById('save').addEventListener('click', save);
document.getElementById('poll').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'poll-now' });
  statusEl.textContent = response.ok ? 'Polled queue.' : response.error;
});

async function init() {
  const response = await chrome.runtime.sendMessage({ type: 'get-status' });
  const data = response.result || DEFAULT_SETTINGS;
  for (const id of ids) {
    if (els[id].type === 'checkbox') els[id].checked = Boolean(data[id]);
    else els[id].value = data[id] || DEFAULT_SETTINGS[id] || '';
  }
  statusEl.textContent = data.lastStatus?.message || 'Ready.';
}

async function save() {
  const settings = {};
  for (const id of ids) {
    settings[id] = els[id].type === 'checkbox' ? els[id].checked : els[id].value.trim();
  }
  const response = await chrome.runtime.sendMessage({ type: 'save-settings', settings });
  statusEl.textContent = response.ok ? 'Saved.' : response.error;
}
