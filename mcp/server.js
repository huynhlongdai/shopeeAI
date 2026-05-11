import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

loadDotEnv(path.join(rootDir, '.env'));

const API_BASE = trimTrailingSlash(process.env.SHOPEEAI_API_BASE || `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 8787}`);
const API_TOKEN = process.env.API_TOKEN || '';

const tools = [
  {
    name: 'shopeeai_health',
    description: 'Check whether the local shopeeAI API server is online.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_create_product_info_job',
    description: 'Create an extension job to collect product information from a Shopee product URL using the real Chrome extension session.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Shopee product URL.' },
        targetProfileId: { type: 'string', description: 'Optional Chrome extension profile id that must process this job.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_create_product_affiliate_job',
    description: 'Create an extension job to collect product data, commission offer, and affiliate link for a Shopee product URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Shopee product URL.' },
        subId1: { type: 'string' },
        subId2: { type: 'string' },
        subId3: { type: 'string' },
        subId4: { type: 'string' },
        subId5: { type: 'string' },
        targetProfileId: { type: 'string', description: 'Optional Chrome extension profile id that must process this job.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_create_product_links_job',
    description: 'Create an extension job to collect Shopee product links from a keyword, search URL, or category URL. Supports pagination through limit and maxPages.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Shopee search keyword.' },
        url: { type: 'string', description: 'Shopee search/listing URL.' },
        categoryUrl: { type: 'string', description: 'Shopee category URL.' },
        limit: { type: 'number', description: 'Maximum products to collect. Default 20, max 500.' },
        maxPages: { type: 'number', description: 'Maximum listing pages to visit. Default inferred from limit, max 50.' },
        targetProfileId: { type: 'string', description: 'Optional Chrome extension profile id that must process this job.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_create_affiliate_links_job',
    description: 'Create an extension job to generate affiliate links for one or more Shopee URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        links: {
          type: 'array',
          items: { type: 'string' },
          description: 'Shopee URLs to convert.',
        },
        subId1: { type: 'string' },
        subId2: { type: 'string' },
        subId3: { type: 'string' },
        subId4: { type: 'string' },
        subId5: { type: 'string' },
        targetProfileId: { type: 'string', description: 'Optional Chrome extension profile id that must process this job.' },
      },
      required: ['links'],
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_list_jobs',
    description: 'List recent extension jobs from the local shopeeAI API queue.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of jobs to return. Default 20, max 100.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_list_profiles',
    description: 'List Chrome extension profiles that have recently connected to the shopeeAI API.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_get_job',
    description: 'Get one extension job, including result when completed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Job id.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_retry_job',
    description: 'Retry a failed/cancelled extension job.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Job id.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_cancel_job',
    description: 'Cancel a queued or running extension job.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Job id.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'shopeeai_latest_product_data',
    description: 'Read the latest product data posted by the Chrome extension.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

const toolHandlers = {
  shopeeai_health: () => api('/health'),
  shopeeai_create_product_info_job: (args) => api('/api/shopee/extension/product-info', {
    method: 'POST',
    body: compactObject({ url: requireString(args.url, 'url'), targetProfileId: args.targetProfileId }),
  }),
  shopeeai_create_product_affiliate_job: (args) => api('/api/shopee/extension/product-affiliate', {
    method: 'POST',
    body: compactObject({
      url: requireString(args.url, 'url'),
      targetProfileId: args.targetProfileId,
      ...subIdBody(args),
    }),
  }),
  shopeeai_create_product_links_job: (args) => api('/api/shopee/extension/product-links', {
    method: 'POST',
    body: compactObject({
      keyword: args.keyword,
      url: args.url,
      categoryUrl: args.categoryUrl,
      limit: args.limit,
      maxPages: args.maxPages,
      targetProfileId: args.targetProfileId,
    }),
  }),
  shopeeai_create_affiliate_links_job: (args) => api('/api/shopee/extension/affiliate-links', {
    method: 'POST',
    body: compactObject({
      links: requireStringArray(args.links, 'links'),
      targetProfileId: args.targetProfileId,
      ...subIdBody(args),
    }),
  }),
  shopeeai_list_jobs: (args) => api(`/api/shopee/extension/jobs?limit=${encodeURIComponent(args.limit || 20)}`),
  shopeeai_list_profiles: () => api('/api/shopee/extension/profiles'),
  shopeeai_get_job: (args) => api(`/api/shopee/extension/jobs/${encodeURIComponent(requireString(args.id, 'id'))}`),
  shopeeai_retry_job: (args) => api(`/api/shopee/extension/jobs/${encodeURIComponent(requireString(args.id, 'id'))}/retry`, {
    method: 'POST',
    body: {},
  }),
  shopeeai_cancel_job: (args) => api(`/api/shopee/extension/jobs/${encodeURIComponent(requireString(args.id, 'id'))}/cancel`, {
    method: 'POST',
    body: {},
  }),
  shopeeai_latest_product_data: () => api('/api/shopee/browser-product-data/latest'),
};

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) handleMessage(line);
  }
});

process.stdin.on('end', () => process.exit(0));

async function handleMessage(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    writeMessage({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    return;
  }

  if (!Object.hasOwn(message, 'id')) return;

  try {
    const result = await dispatch(message);
    writeMessage({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: error.code || -32000,
        message: error.message || 'MCP server error',
      },
    });
  }
}

async function dispatch(message) {
  const params = message.params || {};

  if (message.method === 'initialize') {
    return {
      protocolVersion: params.protocolVersion || '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'shopeeAI',
        version: '1.0.0',
      },
    };
  }

  if (message.method === 'tools/list') {
    return { tools };
  }

  if (message.method === 'tools/call') {
    const name = params.name;
    const handler = toolHandlers[name];
    if (!handler) throw jsonRpcError(-32602, `Unknown tool: ${name}`);

    const data = await handler(params.arguments || {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  if (message.method === 'ping') {
    return {};
  }

  throw jsonRpcError(-32601, `Method not found: ${message.method}`);
}

async function api(pathname, options = {}) {
  const headers = { 'content-type': 'application/json' };
  if (API_TOKEN) headers.authorization = `Bearer ${API_TOKEN}`;

  const response = await fetch(`${API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `shopeeAI API failed: HTTP ${response.status}`);
  }
  return body;
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function loadDotEnv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // .env is optional for MCP; API_TOKEN can also be supplied by the MCP client env.
  }
}

function requireString(value, key) {
  const text = String(value || '').trim();
  if (!text) throw jsonRpcError(-32602, `${key} is required.`);
  return text;
}

function requireStringArray(value, key) {
  if (!Array.isArray(value)) throw jsonRpcError(-32602, `${key} must be an array.`);
  const rows = value.map((row) => String(row || '').trim()).filter(Boolean);
  if (!rows.length) throw jsonRpcError(-32602, `${key} cannot be empty.`);
  return rows;
}

function subIdBody(args) {
  return {
    subId1: args.subId1,
    subId2: args.subId2,
    subId3: args.subId3,
    subId4: args.subId4,
    subId5: args.subId5,
  };
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function jsonRpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
