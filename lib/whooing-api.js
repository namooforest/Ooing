/**
 * Whooing API 클라이언트
 *
 * 지원하는 인증 방식:
 *   1. API Key (X-API-KEY 헤더) — 개인 AI 연동용
 *   2. OAuth 2.0 Bearer Token (Authorization 헤더) — 배포용 앱
 */
const WhooingAPI = (() => {
  const BASE_URL = 'https://whooing.com/api';
  let _tempConfig = null;

  function setTempConfig(config) {
    _tempConfig = config;
  }

  async function getConfig() {
    if (_tempConfig) return _tempConfig;
    return new Promise(resolve => {
      chrome.storage.local.get(['ooingConfig'], (result) => {
        resolve(result.ooingConfig || {});
      });
    });
  }

  async function buildHeaders() {
    const config = await getConfig();
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    if (config.authMethod === 'oauth2' && config.accessToken) {
      headers['Authorization'] = `Bearer ${config.accessToken}`;
    } else if (config.apiKey) {
      headers['X-API-KEY'] = config.apiKey;
    }

    return headers;
  }

  async function request(method, path, params = {}) {
    const headers = await buildHeaders();
    const url = new URL(`${BASE_URL}/${path}`);

    const options = { method, headers };

    if (method === 'GET') {
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          url.searchParams.append(key, val);
        }
      });
    } else {
      const body = new URLSearchParams();
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          body.append(key, val);
        }
      });
      options.body = body.toString();
    }

    const response = await fetch(url.toString(), options);
    return response.json();
  }

  // --- User ---
  function getUser() {
    return request('GET', 'user.json');
  }

  // --- Sections ---
  function getSections() {
    return request('GET', 'sections.json');
  }

  // --- Accounts ---
  function getAccounts(sectionId) {
    return request('GET', 'accounts.json', { section_id: sectionId });
  }

  // --- Entries ---

  /**
   * 거래 내역 일괄 등록 (최대 300건)
   *
   * @param {string} sectionId - 섹션 ID
   * @param {Array<Object>} entries - 거래 배열
   *   각 항목: { entry_date, l_account, l_account_id, r_account, r_account_id, item, money, memo }
   */
  function postEntries(sectionId, entries) {
    if (entries.length === 1) {
      const e = entries[0];
      return request('POST', 'entries.json', {
        section_id: sectionId,
        entry_date: e.entry_date,
        l_account: e.l_account,
        l_account_id: e.l_account_id,
        r_account: e.r_account,
        r_account_id: e.r_account_id,
        item: e.item || '',
        money: e.money,
        memo: e.memo || '',
      });
    }

    return request('POST', 'entries.json', {
      section_id: sectionId,
      data_type: 'json',
      entries: JSON.stringify(entries),
    });
  }

  function getEntries(sectionId, params = {}) {
    return request('GET', 'entries.json', { section_id: sectionId, ...params });
  }

  // --- Latest Items (자동완성용) ---
  function getLatestItems(sectionId) {
    return request('GET', 'entries/latest_items.json', { section_id: sectionId });
  }

  return {
    setTempConfig,
    getConfig,
    getUser,
    getSections,
    getAccounts,
    postEntries,
    getEntries,
    getLatestItems,
  };
})();
