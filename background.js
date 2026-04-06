/**
 * Ooing - Background Service Worker
 *
 * 역할:
 *   - 확장 프로그램 설치/업데이트 시 초기화
 *   - 팝업/옵션 페이지에서 보낸 메시지 처리
 *   - 아이콘 클릭 시 중앙 팝업 윈도우 열기
 */

let popupWindowId = null;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      ooingConfig: {
        authMethod: 'apikey',
        apiKey: '',
      }
    });
  }
});

async function findExistingPopup() {
  const allWindows = await chrome.windows.getAll({ populate: true });
  for (const win of allWindows) {
    if (win.type !== 'popup') continue;
    const popupTab = win.tabs?.find(t => t.url?.includes('popup/popup.html'));
    if (popupTab) return win.id;
  }
  return null;
}

chrome.action.onClicked.addListener(async (tab) => {
  // 기존 팝업이 열려있으면 포커스만
  const existing = popupWindowId || await findExistingPopup();
  if (existing) {
    try {
      await chrome.windows.update(existing, { focused: true });
      popupWindowId = existing;
      return;
    } catch (e) {
      popupWindowId = null;
    }
  }

  const currentWindow = await chrome.windows.getCurrent();
  const width = 520;
  const height = 620;
  const left = Math.round(currentWindow.left + (currentWindow.width - width) / 2);
  const top = Math.round(currentWindow.top + (currentWindow.height - height) / 2);

  const popup = await chrome.windows.create({
    url: `popup/popup.html?tabId=${tab.id}`,
    type: 'popup',
    width,
    height,
    left,
    top,
    focused: true,
  });

  popupWindowId = popup.id;
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) popupWindowId = null;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CONFIG') {
    chrome.storage.local.get(['ooingConfig'], (result) => {
      sendResponse(result.ooingConfig || {});
    });
    return true;
  }

  if (message.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
});
