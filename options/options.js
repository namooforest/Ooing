document.addEventListener('DOMContentLoaded', async () => {
  const authMethod = document.getElementById('auth-method');
  const authApiKey = document.getElementById('auth-apikey');
  const authOAuth2 = document.getElementById('auth-oauth2');
  const apiKeyInput = document.getElementById('api-key');
  const appIdInput = document.getElementById('app-id');
  const appSecretInput = document.getElementById('app-secret');
  const accessTokenInput = document.getElementById('access-token');
  const refreshTokenInput = document.getElementById('refresh-token');
  const btnTest = document.getElementById('btn-test');
  const testResult = document.getElementById('test-result');
  const btnSave = document.getElementById('btn-save');
  const saveResult = document.getElementById('save-result');

  const config = await loadConfig();
  applyConfig(config);

  authMethod.addEventListener('change', () => {
    const method = authMethod.value;
    authApiKey.style.display = method === 'apikey' ? 'block' : 'none';
    authOAuth2.style.display = method === 'oauth2' ? 'block' : 'none';
  });

  btnTest.addEventListener('click', async () => {
    testResult.style.display = 'none';
    collectAndApplyTempConfig();

    try {
      const data = await WhooingAPI.getUser();
      if (data.code === 200) {
        showTestResult(`연결 성공! (${data.results.username})`, 'success');
      } else if (data.code === 405) {
        showTestResult('인증 토큰이 만료되었거나 잘못되었습니다.', 'error');
      } else {
        showTestResult(`연결 실패: 코드 ${data.code}`, 'error');
      }
    } catch (err) {
      showTestResult(`연결 실패: ${err.message}`, 'error');
    }
  });

  btnSave.addEventListener('click', async () => {
    const existing = await loadConfig();
    const newConfig = {
      ...existing,
      authMethod: authMethod.value,
      apiKey: apiKeyInput.value.trim(),
      appId: appIdInput.value.trim(),
      appSecret: appSecretInput.value.trim(),
      accessToken: accessTokenInput.value.trim(),
      refreshToken: refreshTokenInput.value.trim(),
    };

    await saveConfig(newConfig);
    showSaveResult('설정이 저장되었습니다.', 'success');
  });

  // --- 헬퍼 함수 ---

  function applyConfig(cfg) {
    if (cfg.authMethod) {
      authMethod.value = cfg.authMethod;
      authMethod.dispatchEvent(new Event('change'));
    }
    if (cfg.apiKey) apiKeyInput.value = cfg.apiKey;
    if (cfg.appId) appIdInput.value = cfg.appId;
    if (cfg.appSecret) appSecretInput.value = cfg.appSecret;
    if (cfg.accessToken) accessTokenInput.value = cfg.accessToken;
    if (cfg.refreshToken) refreshTokenInput.value = cfg.refreshToken;
  }

  function collectAndApplyTempConfig() {
    const tempConfig = {
      authMethod: authMethod.value,
      apiKey: apiKeyInput.value.trim(),
      accessToken: accessTokenInput.value.trim(),
    };
    WhooingAPI.setTempConfig(tempConfig);
  }

  function showTestResult(msg, type) {
    testResult.style.display = 'block';
    testResult.className = `test-result ${type}`;
    testResult.textContent = msg;
  }

  function showSaveResult(msg, type) {
    saveResult.style.display = 'block';
    saveResult.className = `save-result ${type}`;
    saveResult.textContent = msg;
    setTimeout(() => { saveResult.style.display = 'none'; }, 3000);
  }

  function loadConfig() {
    return new Promise(resolve => {
      chrome.storage.local.get(['ooingConfig'], (result) => {
        resolve(result.ooingConfig || {});
      });
    });
  }

  function saveConfig(config) {
    return new Promise(resolve => {
      chrome.storage.local.set({ ooingConfig: config }, resolve);
    });
  }
});
