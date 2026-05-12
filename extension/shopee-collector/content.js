chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'collect-shopee-product') {
    collectShopeeProduct()
      .then((productData) => sendResponse({ ok: true, productData }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === 'collect-affiliate-links') {
    collectAffiliateLinks(message.input)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === 'collect-affiliate-offer') {
    collectAffiliateOffer(message.itemId)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === 'collect-product-links') {
    collectProductLinks(message.input)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  return false;
});

let latestCollectedProduct;
const productCardCache = new Map();

initShopeeCollectorPanel();
initProductCardTools();
initProductDetailTools();

async function collectShopeeProduct() {
  const bodyText = document.body?.innerText || '';
  const ids = extractProductIds(location.href);
  const apiProduct = ids ? await fetchShopeeProductApi(ids).catch(() => undefined) : undefined;
  const apiReviews = ids ? await fetchShopeeReviewsApi(ids).catch(() => undefined) : undefined;
  const images = apiProduct?.images?.length ? apiProduct.images : collectImages();
  const videos = collectVideos();
  const priceTexts = [...bodyText.matchAll(/(?:₫\s*)?(\d{1,3}(?:[.,]\d{3})+)\s*₫/g)].map((match) => match[0]);
  const priceValues = priceTexts.map(parseVietnamDong).filter(Number.isFinite);
  const salePrice = priceValues.length ? Math.min(...priceValues) : undefined;
  const originalPrice = priceValues.length > 1 ? Math.max(...priceValues) : undefined;

  const productData = compactObject({
    source: 'extension',
    url: location.href,
    title: document.title,
    shopId: ids?.shopId,
    itemId: ids?.itemId,
    name: cleanProductName(apiProduct?.name || getCurrentProductTitle() || titleName()),
    description: apiProduct?.description || extractDescription(bodyText),
    salePrice: apiProduct?.salePrice ?? salePrice,
    originalPrice: apiProduct?.originalPrice ?? originalPrice,
    discount: apiProduct?.discount || firstMatch(bodyText, /-\d+%/),
    sold: apiProduct?.sold ?? firstMatch(bodyText, /([\d.,]+k?\+?)\s+Sold/i),
    soldValue: normalizeCompactNumber(apiProduct?.sold ?? firstMatch(bodyText, /([\d.,]+k?\+?)\s+Sold/i)),
    rating: normalizeLocaleNumber(apiProduct?.rating ?? firstMatch(bodyText, /(?:^|\n)\s*(\d(?:[.,]\d)?)\s*(?=\n[\d.,]+k?\s+ratings)/i)),
    totalRatings: apiProduct?.totalRatings ?? firstMatch(bodyText, /([\d.,]+k?)\s+ratings/i),
    totalRatingsValue: normalizeCompactNumber(apiProduct?.totalRatings ?? firstMatch(bodyText, /([\d.,]+k?)\s+ratings/i)),
    shop: apiProduct?.shop || extractShop(bodyText),
    images: chooseBestImages(images),
    videos: apiProduct?.videos?.length ? apiProduct.videos : videos,
    hasVideo: Boolean(apiProduct?.videos?.length || videos.length || /icon video play|video/i.test(bodyText)),
    reviews: apiReviews || extractReviews(bodyText),
    capturedAt: new Date().toISOString(),
  });

  latestCollectedProduct = productData;
  renderCollectorPanel();
  return productData;
}

async function fetchShopeeProductApi(ids) {
  const params = new URLSearchParams({
    shop_id: ids.shopId,
    item_id: ids.itemId,
    detail_level: '0',
  });
  const response = await fetch(`/api/v4/pdp/get_pc?${params.toString()}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  const json = await response.json();
  const data = json?.data;
  const item = data?.item || {};
  if (!data || !item) return undefined;

  const priceInfo = item.price_info || {};
  const salePrice = normalizeShopeePrice(firstNumber(priceInfo.price, item.price, item.price_min));
  const originalPrice = normalizeShopeePrice(
    firstNumber(priceInfo.price_before_discount, item.price_before_discount, item.price_before_discount_min),
  );
  const ratingCounts = Array.isArray(item.item_rating?.rating_count) ? item.item_rating.rating_count : [];

  return compactObject({
    name: cleanProductName(item.title || item.name),
    description: item.description,
    salePrice,
    originalPrice,
    discount: priceInfo.discount || item.raw_discount,
    sold: firstNumber(item.historical_sold, item.sold),
    rating: item.item_rating?.rating_star,
    totalRatings: firstNumber(item.cmt_count, ratingCounts[0]),
    shop: normalizeShopData(data.shop, item),
    images: normalizeShopeeImages(item.images || (item.image ? [item.image] : [])),
    videos: normalizeShopeeVideos([
      ...(Array.isArray(item.video_info_list) ? item.video_info_list : item.video_info_list ? [item.video_info_list] : []),
      ...(Array.isArray(item.video_info) ? item.video_info : item.video_info ? [item.video_info] : []),
      ...(Array.isArray(item.videos) ? item.videos : item.videos ? [item.videos] : []),
      ...extractShopeeVideosFromObject(data),
    ]),
  });
}

async function fetchShopeeReviewsApi(ids) {
  const params = new URLSearchParams({
    shopid: ids.shopId,
    itemid: ids.itemId,
    offset: '0',
    limit: '20',
    filter: '0',
    flag: '1',
    type: '0',
  });
  const response = await fetch(`/api/v2/item/get_ratings?${params.toString()}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  const json = await response.json();
  const ratings = Array.isArray(json?.data?.ratings) ? json.data.ratings : [];
  if (!ratings.length) return undefined;

  const items = ratings.map((rating) =>
    compactObject({
      rating: rating.rating_star,
      comment: normalizeText(rating.comment),
      author: rating.author_username,
      createdAt: rating.ctime ? new Date(rating.ctime * 1000).toISOString() : undefined,
      images: normalizeShopeeImages(rating.images || []),
      videos: normalizeShopeeVideos(rating.videos || rating.video_info_list || []),
    }),
  );

  return {
    summary: compactObject({
      total: firstNumber(json?.data?.item_rating_summary?.rating_total, json?.data?.count),
      averageRating: average(items.map((item) => item.rating)),
      snippets: items.map((item) => item.comment).filter(Boolean).slice(0, 5),
    }),
    items,
  };
}

async function collectAffiliateLinks(input) {
  if (!/affiliate\.shopee\.vn/i.test(location.hostname)) {
    throw new Error('Affiliate tab is not open.');
  }

  const links = Array.isArray(input?.links) ? input.links : [];
  if (!links.length) throw new Error('No affiliate links provided.');
  const subIds = Array.isArray(input?.subIds) ? input.subIds : [];
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

  try {
    const response = await fetch('/api/v3/gql?q=batchCustomLink', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Affiliate-Program-Type': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => undefined);
    const rows = body?.data?.batchCustomLink;
    if (!response.ok || !Array.isArray(rows)) {
      throw new Error(`Affiliate custom link API failed: ${response.status}`);
    }

    return {
      strategy: 'extension_graphql',
      links: rows.map((row, index) => ({
        originalLink: links[index],
        shortLink: row.shortLink,
        longLink: row.longLink,
        failCode: row.failCode || 0,
      })),
      raw: body,
    };
  } catch (error) {
    const uiResult = await collectAffiliateLinksViaUi(input);
    return {
      ...uiResult,
      fallbackReason: error.message,
    };
  }
}

async function collectAffiliateLinksViaUi(input) {
  const links = Array.isArray(input?.links) ? input.links : [];
  const subIds = Array.isArray(input?.subIds) ? input.subIds : [];
  const beforeLinks = collectAffiliateShortLinksFromPage();
  const textarea = document.querySelector('textarea');
  if (!textarea) throw new Error('Custom Link textarea not found.');

  clearAffiliateUiInputs();
  setNativeValue(textarea, links.join('\n'));

  const inputs = [...document.querySelectorAll('input')].filter((node) =>
    /Sub_id|Example|Please enter/i.test(`${node.placeholder || ''} ${node.getAttribute('aria-label') || ''}`),
  );
  subIds.forEach((subId, index) => {
    if (subId && inputs[index]) setNativeValue(inputs[index], subId);
  });

  const getLinkButton = [...document.querySelectorAll('button')].find((button) => /Get Link|Lấy link/i.test(button.textContent || ''));
  if (!getLinkButton) throw new Error('Get Link button not found.');
  getLinkButton.click();

  const shortLinks = await waitForAffiliateShortLinks(30000, beforeLinks, links.length);

  return {
    strategy: 'extension_ui',
    links: shortLinks.map((shortLink, index) => ({
      originalLink: links[index],
      shortLink,
    })),
  };
}

function waitForAffiliateShortLinks(timeoutMs, beforeLinks = [], expectedCount = 1) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const beforeSet = new Set(beforeLinks);
      const allLinks = collectAffiliateShortLinksFromPage();
      const freshLinks = allLinks.filter((link) => !beforeSet.has(link));
      const selected = freshLinks.length >= expectedCount
        ? freshLinks.slice(-expectedCount)
        : allLinks.slice(-expectedCount);

      if (selected.length >= expectedCount) {
        clearInterval(timer);
        resolve(selected);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for Affiliate UI result.'));
      }
    }, 500);
  });
}

function collectAffiliateShortLinksFromPage() {
  const textValues = [
    ...[...document.querySelectorAll('textarea, input')].map((node) => node.value || node.textContent || ''),
    document.body?.innerText || '',
  ];
  return unique(
    textValues
      .flatMap((value) => String(value).split(/\s+/))
      .map((value) => value.trim().replace(/[),.;\]]+$/g, ''))
      .filter((value) => /^https:\/\/s\.shopee\./i.test(value)),
  );
}

function clearAffiliateUiInputs() {
  [...document.querySelectorAll('textarea, input')]
    .filter((node) => /s\.shopee\.|shopee\.vn|Sub_id|Example|Please enter/i.test(`${node.value || ''} ${node.placeholder || ''}`))
    .forEach((node) => setNativeValue(node, ''));
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function collectAffiliateOffer(itemId) {
  if (!/affiliate\.shopee\.vn/i.test(location.hostname)) {
    throw new Error('Affiliate tab is not open.');
  }
  if (!itemId) throw new Error('itemId is required.');

  const response = await fetch(`/api/v3/offer/product?item_id=${encodeURIComponent(itemId)}`, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'Affiliate-Program-Type': '1',
    },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok || body?.code !== 0 || !body?.data) {
    const uiOffer = collectAffiliateOfferViaUi();
    return {
      ...uiOffer,
      status: response.status,
      raw: body,
      fallbackReason: `Affiliate offer API failed: ${response.status}`,
    };
  }

  const data = body.data;
  return {
    available: true,
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
    priceBeforeDiscount: normalizeShopeePrice(firstNumber(data.price_before_discount, data.price_before_discount_min)),
    shopId: firstDefined(data.shop_id, data.shopid),
    shopName: firstDefined(data.shop_name, data.shopName),
    raw: data,
  };
}

function collectAffiliateOfferViaUi() {
  const text = document.body?.innerText || '';
  const productName = normalizeText(
    firstMatch(text, /Product Offer Details\s*\n\s*Product Offer Details\s*\n([\s\S]*?)\nView Product/i) ||
      firstMatch(text, /Product Offer Details\s*\n([\s\S]*?)\nView Product/i),
  );
  const price = parseVietnamDong(firstMatch(text, /₫\s*\n?\s*([\d.,]+)/));
  const sold = firstMatch(text, /([\d.,]+k?\+?)\s+sold/i);
  const rating = firstMatch(text, /View Product\s*\n\s*([\d.,]+)/i);
  const commissionRows = extractCommissionRowsFromOfferTable();

  return {
    available: commissionRows.length > 0 || Boolean(productName),
    strategy: 'extension_product_offer_ui',
    productName,
    price,
    sold,
    rating,
    commissionRows,
    bestCommission: chooseBestCommission(commissionRows),
  };
}

function extractCommissionRowsFromOfferTable() {
  const rows = [...document.querySelectorAll('table tbody tr')]
    .map((row) => [...row.querySelectorAll('td')].map((cell) => normalizeText(cell.innerText)))
    .filter((cells) => cells.length >= 3);

  return rows.map((cells) => {
    const channelText = cells[0] || '';
    const commissionCells = cells.slice(1);
    const estimatedAmount = commissionCells[commissionCells.length - 1];
    const percentageCells = commissionCells.slice(0, -1);

    return compactObject({
      channelType: normalizeText(channelText.replace(/Most Used Channel/i, '')),
      isMostUsed: /Most Used Channel/i.test(channelText),
      sellerCommission: percentageCells[0],
      shopeeCommission: percentageCells[1],
      estimatedCommissionAmount: estimatedAmount,
      estimatedCommissionValue: parseVietnamDong(estimatedAmount),
    });
  });
}

function extractCommissionRowsFromOfferText(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const channels = ['Social Medias', 'Shopee Live', 'Shopee Video'];
  const rows = [];

  for (const channel of channels) {
    const index = lines.findIndex((line) => line === channel);
    if (index < 0) continue;
    const windowLines = lines.slice(index, index + 8);
    const percentages = windowLines.join(' ').match(/\d+(?:[.,]\d+)?%\s*\(₫[\d.,]+\)/g) || [];
    const amounts = windowLines.join(' ').match(/₫[\d.,]+/g) || [];
    rows.push(
      compactObject({
        channelType: channel,
        isMostUsed: windowLines.some((line) => /Most Used Channel/i.test(line)),
        sellerCommission: percentages[0],
        shopeeCommission: percentages[1],
        estimatedCommissionAmount: amounts[amounts.length - 1],
        estimatedCommissionValue: parseVietnamDong(amounts[amounts.length - 1]),
      }),
    );
  }

  return rows;
}

async function collectProductLinks(input = {}) {
  if (!/shopee\.vn/i.test(location.hostname)) {
    throw new Error('Shopee tab is not open.');
  }

  const limit = Math.min(Number(input.limit) || 20, 100);
  await scrollSearchResults();
  const links = [...document.querySelectorAll('a[href*="-i."], a[href*="/product/"]')]
    .map((anchor) => {
      const url = normalizeShopeeProductUrl(anchor.href);
      const ids = extractProductIds(url);
      const card = anchor.closest('li, div');
      const text = normalizeText(anchor.innerText || card?.innerText);
      const image = normalizeShopeeImage(card?.querySelector('img')?.currentSrc || card?.querySelector('img')?.src);
      const price = extractListingPrice(text);
      const sold = firstMatch(text, /([\d.,]+k?\+?)\s+sold/i);

      return compactObject({
        url,
        shopId: ids?.shopId,
        itemId: ids?.itemId,
        title: text,
        image,
        price,
        sold,
        soldValue: normalizeCompactNumber(sold),
      });
    })
    .filter((item) => item.url && item.itemId);

  const uniqueByItem = [];
  const seen = new Set();
  for (const link of links) {
    const key = `${link.shopId}.${link.itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueByItem.push(link);
    if (uniqueByItem.length >= limit) break;
  }

  return {
    source: 'extension',
    pageUrl: location.href,
    keyword: input.keyword,
    categoryUrl: input.categoryUrl,
    count: uniqueByItem.length,
    links: uniqueByItem,
    capturedAt: new Date().toISOString(),
  };
}

function extractListingPrice(text) {
  const values = [
    ...String(text || '').matchAll(/([\d.,]+)\s*₫/g),
    ...String(text || '').matchAll(/₫\s*([\d.,]+)/g),
  ]
    .map((match) => parseVietnamDong(match[1]))
    .filter(Number.isFinite)
    .filter((value) => value >= 1000);

  return values.length ? Math.min(...values) : undefined;
}

async function scrollSearchResults() {
  for (let index = 0; index < 4; index += 1) {
    window.scrollBy(0, Math.round(window.innerHeight * 0.85));
    await delay(700);
  }
}

function normalizeShopeeProductUrl(url) {
  const parsed = new URL(url, location.href);
  parsed.hash = '';
  parsed.search = '';
  return parsed.href;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chooseBestCommission(rows) {
  const sorted = [...rows].sort(
    (a, b) => (b.estimatedCommissionValue || 0) - (a.estimatedCommissionValue || 0),
  );
  return sorted[0];
}

function collectImages() {
  const scopedImages = collectVisibleProductImages();
  const urls = scopedImages.length ? scopedImages : [
    ...[...document.querySelectorAll('img')].map((img) => img.currentSrc || img.src),
    ...[...document.querySelectorAll('[style*="background-image"]')].map((node) =>
      firstMatch(node.getAttribute('style'), /url\(["']?([^"')]+)["']?\)/i),
    ),
    document.querySelector('meta[property="og:image"]')?.content,
  ];

  return unique(
    urls
      .filter(Boolean)
      .map(absolutizeUrl)
      .map(toLargeShopeeImage)
      .filter((url) => /susercontent|shopee/i.test(url))
      .filter(isLikelyProductImage),
  );
}

function collectVisibleProductImages() {
  return [...document.querySelectorAll('img')]
    .filter((img) => {
      const rect = img.getBoundingClientRect();
      const url = img.currentSrc || img.src;
      return rect.width >= 40
        && rect.height >= 40
        && rect.top >= -50
        && rect.top <= window.innerHeight * 1.5
        && /susercontent|shopee/i.test(url);
    })
    .map((img) => img.currentSrc || img.src);
}

function collectVideos() {
  const urls = [
    ...[...document.querySelectorAll('video')].map((video) => video.currentSrc || video.src),
    ...[...document.querySelectorAll('video source')].map((source) => source.src),
    ...performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => /\.(mp4|m3u8)(\?|$)/i.test(url) || /cvf\.shopee\.[^/]+\/file\//i.test(url)),
    ...collectVideoUrlsFromScripts(),
  ];

  return uniqueShopeeVideos(unique(urls.filter(Boolean).map(absolutizeUrl)).map((url) => ({ url })));
}

function collectVideoUrlsFromScripts() {
  const scriptText = [...document.scripts]
    .map((script) => script.textContent || '')
    .filter((text) => /video|cvf\.shopee|mp4|m3u8/i.test(text))
    .join('\n');
  if (!scriptText) return [];

  const directUrls = [
    ...scriptText.matchAll(/https?:\\?\/\\?\/(?:cvf|down-[^"'\\\s]+)\.shopee\.[^"'\\\s]+\\?\/file\\?\/[^"'\\\s]+/gi),
    ...scriptText.matchAll(/https?:\\?\/\\?\/[^"'\\\s]+?\.(?:mp4|m3u8)(?:\?[^"'\\\s]*)?/gi),
  ].map((match) => match[0].replaceAll('\\/', '/'));

  const ids = [
    ...scriptText.matchAll(/"video_?id"\s*:\s*"([^"]+)"/gi),
    ...scriptText.matchAll(/"video_?id"\s*:\s*(\d+)/gi),
  ].map((match) => `https://cvf.shopee.vn/file/${match[1]}`);

  return [...directUrls, ...ids].filter((url) => /cvf\.shopee|\.mp4|\.m3u8/i.test(url));
}

function extractDescription(text) {
  const description = firstMatch(
    text,
    /Product Description\s*\n([\s\S]*?)(?:\nProduct Ratings|\nRatings|\nRecommended|CUSTOMER SERVICE|ABOUT SHOPEE|$)/i,
  ) || firstMatch(
    text,
    /Mô tả sản phẩm\s*\n([\s\S]*?)(?:\nĐánh giá|\nSản phẩm liên quan|DỊCH VỤ KHÁCH HÀNG|VỀ SHOPEE|$)/i,
  );

  return normalizeText(description);
}

function extractShop(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const viewShopIndex = lines.findIndex((line) => /view shop|xem shop/i.test(line));
  const candidates = viewShopIndex > 0 ? lines.slice(Math.max(0, viewShopIndex - 6), viewShopIndex).reverse() : [];
  const name = candidates.find(isLikelyShopName);

  return compactObject({
    name,
    rating: firstMatch(text, /Shop rating\s*([\d.,]+)/i),
    followers: firstMatch(text, /([\d.,]+k?)\s+followers/i),
    responseRate: firstMatch(text, /(\d+%)\s+Chat Response/i),
  });
}

function normalizeShopData(shop, item = {}) {
  if (!shop && !item) return undefined;
  const name = [
    shop?.name,
    shop?.shop_name,
    shop?.account?.username,
    shop?.username,
    item.shop_name,
    item.shop?.name,
    item.shop?.shop_name,
  ].find(isLikelyShopName);

  return compactObject({
    id: shop?.shopid || shop?.shop_id || item.shopid || item.shop_id,
    name,
    username: shop?.account?.username || shop?.username,
    rating: shop?.rating_star,
    followers: firstNumber(shop?.follower_count, shop?.followers),
    responseRate: shop?.response_rate,
    location: shop?.shop_location,
  });
}

function isLikelyShopName(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (text.length < 2 || text.length > 80) return false;
  return !/^(active|online|offline|chat|view shop|xem shop|follow|following|rating|ratings|followers|products|joined|ago|phút|giờ|ngày|trước|đang hoạt động|tỉ lệ|tỷ lệ|phản hồi|response|mall|yêu thích)$/i.test(text)
    && !/(\d+\s*(phút|giờ|ngày|minutes?|hours?|days?)\s*(ago|trước)|active\s+\d+|online|chat now|xem shop|view shop|followers|products|ratings)/i.test(text);
}

function extractReviews(text) {
  const averageRating = firstMatch(text, /Product Ratings\s*\n\s*([\d.,]+)\s+out of 5/i);
  const reviewSection = firstMatch(
    text,
    /Product Ratings[\s\S]*?(?:Show More|View all|You May Also Like|Recommended|$)/i,
  );
  const snippets = String(reviewSection || '')
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line) => line.length >= 25 && line.length <= 350)
    .filter((line) => !/add to cart|buy now|shipping|voucher|sold|ratings|sorry, something went wrong|product ratings|show more|view all/i.test(line))
    .slice(0, 10);

  return {
    summary: compactObject({
      averageRating,
      averageRatingValue: normalizeLocaleNumber(averageRating),
      snippets,
    }),
    items: snippets.map((comment) => ({ comment })),
  };
}

function titleName() {
  return normalizeText(document.title.replace(/\s*\|\s*Shopee.*$/i, ''));
}

function extractProductIds(url) {
  const text = String(url || '');
  const match = text.match(/[?&]item_id=(\d+).*?[?&]shop_id=(\d+)/i);
  if (match) return { itemId: match[1], shopId: match[2] };

  const patterns = [
    /(?:^|[/?&.-])i\.(\d+)\.(\d+)(?:[/?&#]|$)/i,
    /\/product\/(\d+)\/(\d+)(?:[/?&#]|$)/i,
    /[?&]shop_id=(\d+).*?[?&]item_id=(\d+)/i,
  ];

  for (const pattern of patterns) {
    const row = text.match(pattern);
    if (row) return { shopId: row[1], itemId: row[2] };
  }
  return undefined;
}

function parseVietnamDong(value) {
  const number = Number(String(value || '').replace(/[^\d]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalizeLocaleNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const number = Number(String(value || '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(number) ? number : undefined;
}

function normalizeCompactNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const text = String(value || '').trim().toLowerCase().replace('+', '');
  const multiplier = text.includes('k') ? 1000 : 1;
  const number = normalizeLocaleNumber(text.replace('k', ''));
  return Number.isFinite(number) ? Math.round(number * multiplier) : undefined;
}

function normalizeShopeeImage(image) {
  if (!image) return undefined;
  const url = /^https?:\/\//i.test(image) ? image : `https://down-vn.img.susercontent.com/file/${image}`;
  return toLargeShopeeImage(url);
}

function normalizeShopeeImages(images) {
  if (!Array.isArray(images)) return [];
  return unique(images.map(normalizeShopeeImage).filter(Boolean));
}

function normalizeShopeeVideoUrl(value) {
  if (!value) return undefined;
  const text = String(value);
  if (/^https?:\/\//i.test(text)) return text;
  if (text) return `https://cvf.shopee.vn/file/${text}`;
  return undefined;
}

function normalizeShopeeVideos(videos) {
  if (!videos) return [];
  const rows = Array.isArray(videos) ? videos : [videos];
  return uniqueShopeeVideos(rows
    .flatMap(normalizeShopeeVideoCandidate)
    .filter((video) => video.url || video.id));
}

function normalizeShopeeVideoCandidate(video) {
  if (!video) return [];
  if (typeof video === 'string') return [{ url: normalizeShopeeVideoUrl(video) }].filter((row) => row.url);
  if (typeof video !== 'object') return [];

  const thumbnail = firstDefined(
    video.thumbnail,
    video.thumb_url,
    video.cover,
    video.cover_url,
    video.default_format?.thumbnail,
    video.default_format?.cover,
  );
  const id = firstDefined(video.video_id, video.videoid, video.id);
  const duration = firstNumber(video.duration, video.default_format?.duration);
  const directUrls = unique([
    video.default_format?.url,
    video.default_format?.play_url,
    video.default_format?.download_url,
    video.default_format?.transcoded_url,
    video.default_format?.defn_video_url,
    video.video_url,
    video.play_url,
    video.download_url,
    video.transcoded_url,
    video.defn_video_url,
    video.url,
    video.src,
    video.video_id,
    video.videoid,
  ].filter(Boolean));

  const nestedRows = [
    video.formats,
    video.format,
    video.default_format,
    video.video_url_list,
    video.url_list,
    video.urls,
    video.sources,
  ].flatMap((value) => normalizeShopeeVideos(value));

  const rows = directUrls.map((url) =>
    compactObject({
      id,
      url: normalizeShopeeVideoUrl(url),
      thumbnail: normalizeShopeeImage(thumbnail),
      duration,
    }),
  );

  if (!rows.length && id) {
    rows.push(compactObject({ id, url: normalizeShopeeVideoUrl(id), thumbnail: normalizeShopeeImage(thumbnail), duration }));
  }

  return [...rows, ...nestedRows];
}

function uniqueShopeeVideos(videos) {
  const grouped = new Map();
  for (const video of videos) {
    const key = videoKey(video.url || video.id);
    const current = grouped.get(key);
    if (!current || videoScore(video) > videoScore(current)) grouped.set(key, video);
  }
  return [...grouped.values()];
}

function videoKey(value) {
  const text = String(value || '');
  const file = text.split('/').pop() || text;
  return file.replace(/\.(?:default|\d+)\.mp4(?:\?.*)?$/i, '').replace(/\?.*$/, '') || text;
}

function videoScore(video) {
  const url = String(video.url || '');
  if (/\.default\.mp4/i.test(url)) return 100;
  if (/mms\.vod\.susercontent/i.test(url)) return 80;
  if (/\.mp4/i.test(url)) return 50;
  if (/m3u8/i.test(url)) return 40;
  return video.url ? 10 : 1;
}

function extractShopeeVideosFromObject(value, depth = 0) {
  if (!value || depth > 6) return [];
  if (Array.isArray(value)) return value.flatMap((item) => extractShopeeVideosFromObject(item, depth + 1));
  if (typeof value !== 'object') return [];

  const rows = [];
  const keys = Object.keys(value);
  const hasVideoKey = keys.some((key) => /video/i.test(key));
  const url = firstDefined(value.default_format?.url, value.video_url, value.url, value.video_id, value.videoid);
  if (hasVideoKey && url) {
    rows.push(value);
  }

  for (const [key, child] of Object.entries(value)) {
    if (/image|rating|comment|description/i.test(key) && !/video/i.test(key)) continue;
    rows.push(...extractShopeeVideosFromObject(child, depth + 1));
  }
  return rows;
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

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return undefined;
  return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10;
}

function firstMatch(text, pattern) {
  const match = String(text || '').match(pattern);
  return match?.[1] || match?.[0];
}

function normalizeText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function absolutizeUrl(url) {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function chooseBestImages(...groups) {
  const merged = groups.flat().filter(Boolean).map(toLargeShopeeImage).filter(isLikelyProductImage);
  const productIdImages = merged.filter((url) => /down-vn\.img\.susercontent\.com\/file\/(vn-111342|sg-111342|id-111342)/i.test(url));
  return unique(productIdImages.length ? productIdImages : merged).slice(0, 30);
}

function toLargeShopeeImage(url) {
  return String(url || '')
    .replace(/_tn(?=$|[?#])/i, '')
    .replace(/_thumbnail(?=$|[?#])/i, '')
    .replace(/_resize[^/?#]*(?=$|[?#])/i, '')
    .replace(/@resize[^/?#]*(?=$|[?#])/i, '')
    .replace(/\?.*$/, '');
}

function isLikelyProductImage(url) {
  if (!url) return false;
  if (/\.(svg|ico)(\?|$)/i.test(url)) return false;
  if (/icon|logo|avatar|sprite|productdetailspage|pcmall-live-sg/i.test(url)) return false;
  return /down-[a-z-]+\.img\.susercontent\.com\/file\//i.test(url);
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
      return true;
    }),
  );
}

function initShopeeCollectorPanel() {
  if (!/shopee\.vn/i.test(location.hostname)) return;
  if (document.getElementById('slpc-panel')) return;

  const style = document.createElement('style');
  style.textContent = `
    #slpc-panel {
      position: fixed;
      right: 18px;
      bottom: 86px;
      z-index: 2147483647;
      width: min(318px, calc(100vw - 32px));
      max-height: min(620px, calc(100vh - 118px));
      overflow: auto;
      border: 1px solid rgba(18, 28, 45, .14);
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 12px 32px rgba(18, 28, 45, .18);
      color: #17202a;
      font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #slpc-panel.slpc-collapsed { width: 170px; max-height: 44px; overflow: hidden; }
    #slpc-panel * { box-sizing: border-box; }
    .slpc-head { align-items: center; background: #ee4d2d; color: #fff; display: flex; gap: 8px; min-height: 44px; padding: 8px 10px; }
    .slpc-title { flex: 1; font-weight: 700; }
    .slpc-icon { background: rgba(255,255,255,.18); border: 0; border-radius: 6px; color: #fff; cursor: pointer; height: 26px; min-width: 26px; }
    .slpc-body { display: grid; gap: 8px; overflow: hidden; padding: 9px; }
    .slpc-row { display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .slpc-btn { background: #2f6fed; border: 0; border-radius: 6px; color: #fff; cursor: pointer; flex: 1; font: inherit; padding: 7px 8px; }
    .slpc-btn, .slpc-icon { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .slpc-btn.alt { background: #1f8a5b; }
    .slpc-btn.muted { background: #64748b; }
    .slpc-card { border: 1px solid #dbe2ea; border-radius: 8px; padding: 8px; }
    .slpc-label { color: #627084; font-size: 11px; text-transform: uppercase; }
    .slpc-value { font-weight: 650; overflow-wrap: anywhere; }
    .slpc-list { display: grid; gap: 4px; margin-top: 4px; }
    .slpc-job { align-items: center; display: flex; gap: 6px; justify-content: space-between; }
    .slpc-dot { border-radius: 999px; display: inline-block; height: 8px; width: 8px; }
    .slpc-dot.completed, .slpc-dot.connected { background: #1f8a5b; }
    .slpc-dot.running, .slpc-dot.queued { background: #d97706; }
    .slpc-dot.failed, .slpc-dot.error { background: #dc2626; }
    .slpc-dot.idle { background: #64748b; }
    .slpc-media { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 2px; }
    .slpc-media img { border-radius: 6px; height: 42px; object-fit: cover; width: 42px; }
    .slpc-card-tools {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      left: 6px;
      position: absolute;
      right: auto;
      top: 6px;
      z-index: 50;
    }
    .slpc-card-tools button {
      background: rgba(238,77,45,.96);
      border: 0;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(18,28,45,.16);
      color: #fff;
      cursor: pointer;
      font: 600 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 24px;
      padding: 6px 8px;
    }
    .slpc-card-tools button.slpc-good { background: rgba(31,138,91,.96); }
    .slpc-card-tools button.slpc-muted { background: rgba(51,65,85,.92); }
    .slpc-card-tools button:disabled { cursor: wait; opacity: .78; }
    .slpc-detail-tools {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 10px 0 8px;
      max-width: 100%;
      position: relative;
      z-index: 20;
    }
    .slpc-detail-tools button {
      background: #ee4d2d;
      border: 0;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      font: 650 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 28px;
      padding: 7px 10px;
      white-space: nowrap;
    }
    .slpc-detail-tools button.slpc-good { background: #1f8a5b; }
    .slpc-detail-tools button.slpc-muted { background: #334155; }
    .slpc-detail-tools button:disabled { cursor: wait; opacity: .78; }
    @media (max-width: 760px) {
      #slpc-panel { bottom: 72px; right: 10px; width: min(300px, calc(100vw - 20px)); }
      .slpc-row { grid-template-columns: 1fr 1fr; }
      .slpc-detail-tools { gap: 5px; }
      .slpc-detail-tools button { font-size: 11px; min-height: 26px; padding: 6px 8px; }
    }
  `;
  document.documentElement.appendChild(style);

  const panel = document.createElement('section');
  panel.id = 'slpc-panel';
  panel.innerHTML = `
    <div class="slpc-head">
      <div class="slpc-title">shopeeAI</div>
      <button class="slpc-icon" id="slpc-refresh" title="Refresh">↻</button>
      <button class="slpc-icon" id="slpc-collapse" title="Collapse">＋</button>
    </div>
    <div class="slpc-body" id="slpc-body"></div>
  `;
  document.documentElement.appendChild(panel);

  panel.classList.add('slpc-collapsed');
  panel.querySelector('#slpc-collapse').addEventListener('click', () => {
    panel.classList.toggle('slpc-collapsed');
    panel.querySelector('#slpc-collapse').textContent = panel.classList.contains('slpc-collapsed') ? '＋' : '−';
  });
  panel.querySelector('#slpc-refresh').addEventListener('click', renderCollectorPanel);
  renderCollectorPanel();
  setInterval(renderCollectorPanel, 5000);
  setInterval(initProductCardTools, 2500);
  setInterval(initProductDetailTools, 1500);
}

function initProductDetailTools() {
  if (!/shopee\.vn/i.test(location.hostname)) return;

  const ids = extractProductIds(location.href);
  const existing = document.getElementById('slpc-detail-tools');
  if (!ids?.itemId) {
    existing?.remove();
    return;
  }

  const key = `${ids.shopId}.${ids.itemId}`;
  if (existing?.dataset.productKey === key) return;
  existing?.remove();

  const mount = findProductDetailToolbarMount();
  if (!mount) return;

  const toolbar = document.createElement('div');
  toolbar.id = 'slpc-detail-tools';
  toolbar.className = 'slpc-detail-tools';
  toolbar.dataset.productKey = key;
  toolbar.innerHTML = `
    <button class="slpc-muted" data-slpc-detail-action="copy-name" title="Copy product name">Tên</button>
    <button class="slpc-muted" data-slpc-detail-action="copy-description" title="Copy product description">Mô tả</button>
    <button class="slpc-muted" data-slpc-detail-action="copy-id" title="Copy shopId.itemId">ID</button>
    <button class="slpc-muted" data-slpc-detail-action="copy-link" title="Copy canonical product link">Link</button>
    <button data-slpc-detail-action="affiliate" title="Create affiliate link and copy it">Aff</button>
    <button class="slpc-good" data-slpc-detail-action="images" title="Download all product images">Ảnh</button>
    <button class="slpc-good" data-slpc-detail-action="videos" title="Download product videos">Video</button>
  `;
  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-slpc-detail-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    handleProductDetailAction(button.dataset.slpcDetailAction, button);
  });
  mount.insertAdjacentElement('afterend', toolbar);
}

function findProductDetailToolbarMount() {
  const heading = document.querySelector('h1');
  if (isVisibleElement(heading)) return heading;

  const infoTitle = findProductInfoColumnTitle();
  if (infoTitle) return infoTitle;

  const expectedName = titleName();
  const titleLike = [...document.querySelectorAll('main div, main span, body div, body span')]
    .filter((element) => isVisibleElement(element))
    .map((element) => ({ element, text: normalizeText(element.textContent) }))
    .filter(({ element, text }) => {
      const rect = element.getBoundingClientRect();
      return text.length >= 35
        && text.length <= 240
        && rect.width >= 360
        && rect.top >= 120
        && rect.top <= Math.max(window.innerHeight, 900)
        && !/Shopee Home|Download|Follow us|Notifications|Search in Shopee|Add To Cart|Buy Now/i.test(text);
    })
    .sort((a, b) => a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top);

  const titleMatch = titleLike.find(({ text }) =>
    expectedName && (text.includes(expectedName.slice(0, 45)) || expectedName.includes(text.slice(0, 45))),
  );
  if (titleMatch) return titleMatch.element;

  return titleLike[0]?.element;
}

function findProductInfoColumnTitle() {
  const ratingAnchor = [...document.querySelectorAll('body div, body span')]
    .find((element) => isVisibleElement(element) && /ratings?\s+[\s\S]{0,60}\bsold\b/i.test(normalizeText(element.textContent)));
  const productColumn = findProductInfoColumn(ratingAnchor);
  if (!productColumn) return undefined;

  return [...productColumn.querySelectorAll('div, span')]
    .filter((element) => isVisibleElement(element))
    .map((element) => ({ element, text: normalizeText(element.textContent) }))
    .filter(({ element, text }) => {
      const rect = element.getBoundingClientRect();
      return text.length >= 35
        && text.length <= 240
        && rect.top >= productColumn.getBoundingClientRect().top
        && !/ratings?|sold|₫|shipping|quantity|add to cart|buy now/i.test(text);
    })
    .sort((a, b) => a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top)[0]?.element;
}

function findProductInfoColumn(seed) {
  let node = seed;
  for (let index = 0; node && index < 10; index += 1, node = node.parentElement) {
    if (!isVisibleElement(node)) continue;
    const text = normalizeText(node.textContent);
    const rect = node.getBoundingClientRect();
    if (rect.width >= 520 && /ratings?/i.test(text) && /\bsold\b/i.test(text) && /₫/.test(text)) {
      return node;
    }
  }
  return undefined;
}

function isVisibleElement(element) {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0
    && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity || 1) > 0;
}

function initProductCardTools() {
  if (!/shopee\.vn/i.test(location.hostname)) return;
  const anchors = [...document.querySelectorAll('a[href*="-i."], a[href*="/product/"]')];

  for (const anchor of anchors) {
    const url = normalizeShopeeProductUrl(anchor.href);
    const ids = extractProductIds(url);
    if (!ids?.itemId) continue;

    const card = findProductCard(anchor);
    if (!card || card.dataset.slpcTools === ids.itemId) continue;

    card.dataset.slpcTools = ids.itemId;
    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }

    const title = extractCardTitle(anchor, card);
    const image = toLargeShopeeImage(card.querySelector('img')?.currentSrc || card.querySelector('img')?.src || '');
    const toolbar = document.createElement('div');
    toolbar.className = 'slpc-card-tools';
    toolbar.innerHTML = `
      <button class="slpc-muted" data-slpc-action="copy-link" title="Copy product link">Link</button>
      <button class="slpc-muted" data-slpc-action="copy-name" title="Copy product name">Tên</button>
      <button data-slpc-action="affiliate" title="Create affiliate link and copy it">Aff</button>
      <button class="slpc-good" data-slpc-action="images" title="Download all product images">Ảnh</button>
      <button class="slpc-good" data-slpc-action="videos" title="Download product videos">Video</button>
    `;
    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-slpc-action]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      handleProductCardAction(button.dataset.slpcAction, { url, title, image }, button);
    });
    toolbar.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    card.appendChild(toolbar);
  }
}

function findProductCard(anchor) {
  let node = anchor;
  for (let index = 0; node && index < 8; index += 1, node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const rect = node.getBoundingClientRect();
    const hasImage = Boolean(node.querySelector('img'));
    const hasProductAnchor = Boolean(node.querySelector('a[href*="-i."], a[href*="/product/"]'));
    if (hasImage && hasProductAnchor && rect.width >= 150 && rect.width <= 520 && rect.height >= 180) {
      return node;
    }
  }
  return anchor.closest('li, [data-sqe="item"], .shopee-search-item-result__item, .shop-search-result-view__item');
}

function extractCardTitle(anchor, card) {
  const text = normalizeText(anchor.innerText || card.innerText || '');
  const lines = text
    .split(/\s{2,}|\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const title = lines.find((line) =>
    line.length >= 8
      && line.length <= 180
      && !/^(mall|yêu thích|voucher|₫|sold|đã bán|buy now|mua ngay|only|selling fast)/i.test(line),
  );
  return title || normalizeText(card.querySelector('img')?.alt) || titleName();
}

async function handleProductCardAction(action, item, button) {
  const originalText = button.textContent;
  try {
    button.disabled = true;
    button.textContent = '...';

    if (action === 'copy-link') {
      await navigator.clipboard.writeText(item.url);
      button.textContent = 'OK';
      return;
    }

    if (action === 'copy-name') {
      await navigator.clipboard.writeText(item.title);
      button.textContent = 'OK';
      return;
    }

    if (action === 'affiliate') {
      const response = await sendRuntimeMessage({ type: 'collect-product-affiliate-url', url: item.url });
      if (!response?.ok) throw new Error(response?.error || 'Affiliate failed.');
      const shortLink = response.result?.affiliateLink?.links?.[0]?.shortLink;
      if (!shortLink) throw new Error(response.result?.affiliateLink?.error || 'No affiliate link returned.');
      latestCollectedProduct = response.result.productData;
      productCardCache.set(item.url, response.result.productData);
      await navigator.clipboard.writeText(shortLink);
      button.textContent = 'Copied';
      renderCollectorPanel();
      return;
    }

    const product = await collectProductFromCardUrl(item);
    const items = action === 'images'
      ? mediaDownloadItems(product.images || [item.image].filter(Boolean), product.name || item.title, 'image')
      : mediaDownloadItems((product.videos || []).map((video) => video.url).filter(Boolean), product.name || item.title, 'video');
    if (!items.length) throw new Error(action === 'images' ? 'No images found.' : 'No videos found.');
    const response = await sendRuntimeMessage({ type: 'download-media', items });
    if (!response?.ok) throw new Error(response?.error || 'Download failed.');
    button.textContent = String(items.length);
  } catch (error) {
    button.textContent = 'Err';
    console.warn('[shopeeAI]', error);
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = originalText;
    }, 1600);
  }
}

async function handleProductDetailAction(action, button) {
  const originalText = button.textContent;
  try {
    button.disabled = true;
    button.textContent = '...';

    const ids = extractProductIds(location.href);
    const productKey = ids ? `${ids.shopId}.${ids.itemId}` : '';
    const canonicalUrl = ids ? `https://shopee.vn/product/${ids.shopId}/${ids.itemId}` : normalizeShopeeProductUrl(location.href);

    if (action === 'copy-id') {
      if (!productKey) throw new Error('Product ID not found.');
      await navigator.clipboard.writeText(productKey);
      button.textContent = 'OK';
      return;
    }

    if (action === 'copy-link') {
      await navigator.clipboard.writeText(canonicalUrl);
      button.textContent = 'OK';
      return;
    }

    if (action === 'copy-name') {
      const name = cleanProductName(getCurrentProductTitle() || latestCollectedProduct?.name || titleName());
      await navigator.clipboard.writeText(name);
      button.textContent = 'OK';
      return;
    }

    const product = await collectCurrentProductForDetail();

    if (action === 'copy-description') {
      await navigator.clipboard.writeText(product.description || '');
      button.textContent = product.description ? 'OK' : 'Empty';
      return;
    }

    if (action === 'affiliate') {
      const response = await sendRuntimeMessage({ type: 'collect-current-product-affiliate' });
      if (!response?.ok) throw new Error(response?.error || 'Affiliate failed.');
      latestCollectedProduct = response.result.productData || product;
      const shortLink = response.result.affiliateLink?.links?.[0]?.shortLink;
      if (!shortLink) throw new Error(response.result.affiliateLink?.error || 'No affiliate link returned.');
      await navigator.clipboard.writeText(shortLink);
      button.textContent = 'Copied';
      renderCollectorPanel();
      return;
    }

    const urls = action === 'images'
      ? product.images || []
      : (product.videos || []).map((video) => video.url).filter(Boolean);
    const items = mediaDownloadItems(urls, product.name, action === 'images' ? 'image' : 'video');
    if (!items.length) throw new Error(action === 'images' ? 'No images found.' : 'No videos found.');
    const response = await sendRuntimeMessage({ type: 'download-media', items });
    if (!response?.ok) throw new Error(response?.error || 'Download failed.');
    button.textContent = String(items.length);
  } catch (error) {
    button.textContent = 'Err';
    console.warn('[shopeeAI]', error);
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = originalText;
    }, 1600);
  }
}

function getCurrentProductTitle() {
  const heading = document.querySelector('h1');
  if (isVisibleElement(heading)) return cleanProductName(heading.textContent);
  const mount = findProductDetailToolbarMount();
  return cleanProductName(mount?.textContent);
}

function cleanProductName(value) {
  return normalizeText(value)
    .replace(/\s*Click to Copy\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function collectCurrentProductForDetail() {
  const ids = extractProductIds(location.href);
  const key = ids ? `${ids.shopId}.${ids.itemId}` : normalizeShopeeProductUrl(location.href);
  if (latestCollectedProduct && latestCollectedProduct.itemId === ids?.itemId) {
    return latestCollectedProduct;
  }
  if (productCardCache.has(key)) return productCardCache.get(key);
  const product = await collectShopeeProduct();
  productCardCache.set(key, product);
  if (product.url) productCardCache.set(normalizeShopeeProductUrl(product.url), product);
  return product;
}

async function collectProductFromCardUrl(item) {
  if (productCardCache.has(item.url)) return productCardCache.get(item.url);
  const response = await sendRuntimeMessage({ type: 'collect-product-url', url: item.url });
  if (!response?.ok) throw new Error(response?.error || 'Product collection failed.');
  latestCollectedProduct = response.result;
  productCardCache.set(item.url, response.result);
  renderCollectorPanel();
  return response.result;
}

async function renderCollectorPanel() {
  const body = document.getElementById('slpc-body');
  if (!body) return;

  const dashboard = await sendRuntimeMessage({ type: 'get-dashboard' }).catch((error) => ({ error: error.message }));
  const result = dashboard.result || {};
  const status = result.lastStatus || { state: result.server?.ok ? 'connected' : 'error', message: result.server?.ok ? 'Server connected.' : 'Server disconnected.' };
  const product = latestCollectedProduct || result.latestProductData;
  const imageCount = product?.images?.length || 0;
  const videoCount = product?.videos?.length || 0;

  body.innerHTML = `
    <div class="slpc-card">
      <div class="slpc-label">Server</div>
      <div class="slpc-value"><span class="slpc-dot ${status.state}"></span> ${escapeHtml(status.message || status.state || 'Unknown')}</div>
    </div>
    <div class="slpc-row">
      <button class="slpc-btn" id="slpc-collect">Collect</button>
      <button class="slpc-btn muted" id="slpc-poll">Poll</button>
      <button class="slpc-btn alt" id="slpc-copy">Copy</button>
      <button class="slpc-btn alt" id="slpc-copy-product-link">Copy link</button>
      <button class="slpc-btn" id="slpc-affiliate">Get affiliate</button>
      <button class="slpc-btn muted" id="slpc-manager">Open manager</button>
      <button class="slpc-btn alt" id="slpc-download-images">Download images (${imageCount})</button>
      <button class="slpc-btn alt" id="slpc-download-videos">Videos (${videoCount})</button>
    </div>
    <div class="slpc-card">
      <div class="slpc-label">Current Product</div>
      <div class="slpc-value">${escapeHtml(product?.name || titleName() || 'Not collected yet')}</div>
      <div>${escapeHtml(formatProductMeta(product))}</div>
      ${renderMediaPreview(product)}
    </div>
    <div class="slpc-card">
      <div class="slpc-label">Recent Jobs</div>
      <div class="slpc-list">
        ${(result.jobs || []).map(renderJobRow).join('') || '<div>No jobs yet.</div>'}
      </div>
    </div>
  `;

  body.querySelector('#slpc-collect').addEventListener('click', async () => {
    const response = await sendRuntimeMessage({ type: 'collect-current-tab' });
    if (response.ok) latestCollectedProduct = response.result;
    renderCollectorPanel();
  });
  body.querySelector('#slpc-poll').addEventListener('click', async () => {
    await sendRuntimeMessage({ type: 'poll-now' });
    renderCollectorPanel();
  });
  body.querySelector('#slpc-copy').addEventListener('click', async () => {
    const data = latestCollectedProduct || product || (await collectShopeeProduct());
    await navigator.clipboard.writeText(formatProductForCopy(data));
  });
  body.querySelector('#slpc-copy-product-link').addEventListener('click', async () => {
    const data = latestCollectedProduct || product || (await collectShopeeProduct());
    await navigator.clipboard.writeText(data.url || location.href);
  });
  body.querySelector('#slpc-affiliate').addEventListener('click', async () => {
    const response = await sendRuntimeMessage({ type: 'collect-current-product-affiliate' });
    if (response.ok) {
      latestCollectedProduct = response.result.productData;
      const shortLink = response.result.affiliateLink?.links?.[0]?.shortLink;
      if (shortLink) await navigator.clipboard.writeText(shortLink);
    }
    renderCollectorPanel();
  });
  body.querySelector('#slpc-manager').addEventListener('click', async () => {
    await sendRuntimeMessage({ type: 'open-manager' });
  });
  body.querySelector('#slpc-download-images').addEventListener('click', async () => {
    const data = latestCollectedProduct || product || (await collectShopeeProduct());
    await sendRuntimeMessage({ type: 'download-media', items: mediaDownloadItems(data.images || [], data.name, 'image') });
  });
  body.querySelector('#slpc-download-videos').addEventListener('click', async () => {
    const data = latestCollectedProduct || product || (await collectShopeeProduct());
    await sendRuntimeMessage({
      type: 'download-media',
      items: mediaDownloadItems((data.videos || []).map((video) => video.url).filter(Boolean), data.name, 'video'),
    });
  });
}

function sendRuntimeMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function renderJobRow(job) {
  return `
    <div class="slpc-job">
      <span><span class="slpc-dot ${escapeHtml(job.status)}"></span> #${escapeHtml(job.id)} ${escapeHtml(job.status)}</span>
      <span>${escapeHtml((job.updatedAt || '').slice(11, 19))}</span>
    </div>
  `;
}

function renderMediaPreview(product) {
  const images = (product?.images || []).slice(0, 8);
  if (!images.length) return '';
  return `<div class="slpc-media">${images.map((url) => `<img src="${escapeHtml(url)}" alt="">`).join('')}</div>`;
}

function formatProductMeta(product) {
  if (!product) return '';
  const parts = [];
  if (product.salePrice) parts.push(`Price: ${product.salePrice}`);
  if (product.sold) parts.push(`Sold: ${product.sold}`);
  if (product.rating) parts.push(`Rating: ${product.rating}`);
  if (product.totalRatings) parts.push(`Reviews: ${product.totalRatings}`);
  return parts.join(' | ');
}

function formatProductForCopy(data) {
  return [
    data.name,
    data.url,
    data.shop?.name ? `Shop: ${data.shop.name}` : undefined,
    data.salePrice ? `Price: ${data.salePrice}` : undefined,
    data.originalPrice ? `Original: ${data.originalPrice}` : undefined,
    data.discount ? `Discount: ${data.discount}` : undefined,
    data.sold ? `Sold: ${data.sold}` : undefined,
    data.rating ? `Rating: ${data.rating}` : undefined,
    data.description ? `\nDescription:\n${data.description}` : undefined,
    data.images?.length ? `\nImages:\n${data.images.join('\n')}` : undefined,
    data.videos?.length ? `\nVideos:\n${data.videos.map((video) => video.url || video.id).filter(Boolean).join('\n')}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

function mediaDownloadItems(urls, name, type) {
  const slug = normalizeText(name || 'shopee-product')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return urls.map((url, index) => ({
    url,
    filename: `${slug}-${type}-${String(index + 1).padStart(2, '0')}`,
  }));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
