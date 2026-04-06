document.addEventListener('DOMContentLoaded', async () => {
  // --- URL 파라미터 (standalone 팝업 윈도우 모드) ---
  const urlParams = new URLSearchParams(location.search);
  const targetTabId = urlParams.get('tabId') ? parseInt(urlParams.get('tabId')) : null;

  // --- DOM 참조 ---
  const $ = id => document.getElementById(id);
  const authRequired = $('auth-required');
  const mainContent = $('main-content');
  const pageInfoArea = $('page-info-area');
  const pageTitle = $('page-title');
  const btnScrape = $('btn-scrape');
  const scrapeArea = $('scrape-area');
  const cardInfo = $('card-info');
  const cardName = $('card-name');
  const parserVersion = $('parser-version');
  const sectionArea = $('section-area');
  const sectionSelect = $('section-select');
  const initialTotalEl = $('initial-total');
  const bulkAccountArea = $('bulk-account-area');
  const bulkLWrap = $('bulk-l-wrap');
  const bulkRWrap = $('bulk-r-wrap');
  const entriesArea = $('entries-area');
  const entriesList = $('entries-list');
  const pagination = $('pagination');
  const btnUpload = $('btn-upload');
  const uploadCount = $('upload-count');
  const totalCount = $('total-count');
  const progressSection = $('progress-section');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');
  const resultSection = $('result-section');
  const resultMessage = $('result-message');

  // --- 상태 ---
  const PAGE_SIZE = 10;
  let allEntries = [];
  let currentPage = 0;
  let accountOptions = [];
  let initialTotal = 0;  // 최초 파싱 시 전체 합계 (고정값)
  let itemAccountMap = {}; // 아이템명 → { l: accountId, r: accountId }

  // --- 탭 조회 헬퍼 ---
  async function getTargetTab() {
    if (targetTabId) {
      try { return await chrome.tabs.get(targetTabId); } catch (e) { /* 탭이 닫힘 */ }
    }
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0];
  }

  // --- 초기화 ---
  const config = await WhooingAPI.getConfig();
  if (!config.apiKey && !config.accessToken) {
    authRequired.style.display = 'block';
    mainContent.style.display = 'none';
  } else {
    authRequired.style.display = 'none';
    mainContent.style.display = 'flex';
    await loadSections();
    await loadAccountOptions();
    await loadItemAccountMap();
  }

  // 현재 탭 제목 표시
  try {
    const tab = await getTargetTab();
    if (tab) {
      pageTitle.textContent = tab.title || tab.url;
      pageTitle.title = tab.url;
    }
  } catch (e) {
    pageTitle.textContent = '페이지 정보를 가져올 수 없습니다.';
  }

  // --- 이벤트 ---
  $('btn-open-settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // 현재 페이지에서 명세서 읽기
  btnScrape.addEventListener('click', async () => {
    resetAll();
    btnScrape.disabled = true;
    btnScrape.innerHTML = '<span class="spinner"></span> 읽는 중...';

    try {
      if (!chrome.scripting || !chrome.scripting.executeScript) {
        throw new Error(
          'scripting API를 사용할 수 없습니다.\n'
          + 'chrome://extensions 에서 이 확장 프로그램을 새로고침(리로드)해주세요.'
        );
      }

      const tab = await getTargetTab();
      if (!tab?.id) throw new Error('활성 탭을 찾을 수 없습니다.');

      if (tab.url?.startsWith('file://')) {
        const canAccess = await new Promise(r =>
          chrome.extension.isAllowedFileSchemeAccess(r)
        );
        if (!canAccess) {
          throw new Error(
            '로컬 파일 접근 권한이 필요합니다.\n'
            + 'chrome://extensions → Ooing 세부정보 →\n'
            + '"파일 URL에 대한 액세스 허용"을 켜주세요.'
          );
        }
      }

      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/page-scraper.js'] });

      // 삼성카드: '더보기' 버튼을 자동 클릭하여 전체 항목 로드
      btnScrape.innerHTML = '<span class="spinner"></span> 항목 로드 중...';
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => loadAllSamsungItems(),
      });

      btnScrape.innerHTML = '<span class="spinner"></span> 읽는 중...';
      const dataResults = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => scrapePageTables() });
      const scrapedData = dataResults[0]?.result;
      if (!scrapedData) throw new Error('페이지 데이터를 읽을 수 없습니다.');

      if (scrapedData.needsAuth) {
        showResult('보안 인증 후 실행해 주세요.\n비밀번호를 입력하여 명세서를 열고 다시 시도해주세요.', 'warning');
        return;
      }

      const result = CardParsers.detectAndParse(scrapedData);

      if (!result.success) {
        showResult(result.message, result.error === 'unsupported' ? 'warning' : 'error');
        return;
      }

      cardName.textContent = result.cardName;
      parserVersion.textContent = `파서 v${result.parserVersion}`;
      cardInfo.style.display = 'block';

      if (result.entries.length === 0) {
        const isSamsung = result.cardId === 'samsung';
        const msg = isSamsung
          ? '삼성카드 페이지를 감지했지만 이용내역을 찾을 수 없습니다.\n'
            + '1. 보안메일을 복호화했는지 확인해주세요.\n'
            + '2. bill.samsungcard.com으로 이동한 후 \"상세 이용내역\"이\n'
            + '   화면에 보이는 상태에서 다시 시도해주세요.'
          : '명세서를 감지했지만 거래 내역을 인식하지 못했습니다.\n보안메일을 복호화한 후 다시 시도해주세요.';
        showResult(msg, 'warning');
        return;
      }

      allEntries = result.entries.map(e => ({
        ...e,
        lAccountId: '',
        rAccountId: '',
        uploaded: false,
      }));

      // 아이템명 기반 왼쪽/오른쪽 계정 자동 매핑
      applyItemAccountDefaults(allEntries);

      // 초기 합계 계산 (고정값)
      initialTotal = allEntries.reduce((sum, e) => sum + e.money, 0);
      initialTotalEl.textContent = formatMoney(initialTotal) + '원';

      pageInfoArea.style.display = 'none';

      const isPartialLoad = scrapedData.samsungExpectedCount
        && allEntries.length < scrapedData.samsungExpectedCount;

      if (isPartialLoad) {
        scrapeArea.querySelector('.hint').style.display = 'none';
      } else {
        scrapeArea.style.display = 'none';
      }

      sectionArea.style.display = 'block';
      bulkAccountArea.style.display = 'block';
      entriesArea.style.display = 'flex';

      populateBulkSelects('', '');
      updateCounts();
      renderPage(0);

      if (isPartialLoad) {
        showResult(
          `삼성카드 명세서에서 ${allEntries.length}건을 읽었습니다.\n`
          + `(전체 ${scrapedData.samsungExpectedCount}건 중 일부만 화면에 로드됨)\n`
          + '페이지 맨 아래까지 스크롤하여 모든 항목을 로드한 후\n'
          + '다시 읽기 버튼을 눌러주세요.', 'warning'
        );
      }

    } catch (err) {
      showResult(`읽기 실패: ${err.message}`, 'error');
    } finally {
      btnScrape.disabled = false;
      btnScrape.innerHTML = '<span class="btn-icon">&#8595;</span> 현재 페이지에서 명세서 읽기';
    }
  });

  // 일괄 계정 변경은 populateBulkSelects 내 콜백에서 처리

  // 업로드
  btnUpload.addEventListener('click', async () => {
    const sectionId = sectionSelect.value;
    if (!sectionId) { showResult('섹션을 선택해주세요.', 'error'); return; }

    const pending = getPageEntries().filter(e => !e.uploaded);
    if (pending.length === 0) return;

    const noItem = pending.find(e => !e.item || !e.item.trim());
    if (noItem) {
      const idx = allEntries.indexOf(noItem);
      showResult(`아이템명이 비어있는 항목이 있습니다. (${idx + 1}번째)`, 'error');
      return;
    }
    const noMoney = pending.find(e => e.money === 0 || e.money === undefined || e.money === null);
    if (noMoney) {
      const idx = allEntries.indexOf(noMoney);
      showResult(`금액이 0인 항목이 있습니다. (${idx + 1}번째)`, 'error');
      return;
    }
    const noAccount = pending.find(e => !e.lAccountId || !e.rAccountId);
    if (noAccount) {
      const idx = allEntries.indexOf(noAccount);
      const missing = !noAccount.lAccountId ? '왼쪽(차변)' : '오른쪽(대변)';
      showResult(`${missing} 계정이 선택되지 않은 항목이 있습니다. (${idx + 1}번째)`, 'error');
      return;
    }

    btnUpload.disabled = true;
    progressSection.style.display = 'block';
    resultSection.style.display = 'none';

    try {
      const entriesToUpload = pending.map(e => ({
        entry_date: e.entry_date,
        l_account: getAccountType(e.lAccountId) || 'expenses',
        l_account_id: e.lAccountId,
        r_account: getAccountType(e.rAccountId) || 'liabilities',
        r_account_id: e.rAccountId,
        item: e.item,
        money: e.money,
        memo: '',
      }));

      const total = entriesToUpload.length;
      let success = 0;

      const batchSize = 50;
      for (let i = 0; i < total; i += batchSize) {
        const batch = entriesToUpload.slice(i, i + batchSize);
        const result = await WhooingAPI.postEntries(sectionId, batch);
        if (result.code === 200) {
          for (let j = 0; j < batch.length; j++) {
            pending[i + j].uploaded = true;
          }
          success += batch.length;
        }

        const pct = Math.min(100, Math.round(((i + batch.length) / total) * 100));
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `업로드 중... ${i + batch.length}/${total}건`;

        if (i + batchSize < total) await sleep(3000);
      }

      progressSection.style.display = 'none';

      // 업로드 성공한 항목의 아이템→계정 매핑 저장
      const uploaded = pending.filter(e => e.uploaded);
      if (uploaded.length > 0) await saveItemAccountMap(uploaded);

      updateCounts();
      renderPage(currentPage);

      const remaining = allEntries.filter(e => !e.uploaded).length;
      if (remaining === 0) {
        showResult(`전체 ${success}건 업로드 완료!`, 'success');
      } else {
        showResult(`${success}건 업로드 완료. 남은 항목: ${remaining}건`, 'success');
      }
    } catch (err) {
      progressSection.style.display = 'none';
      showResult(`업로드 실패: ${err.message}`, 'error');
    } finally {
      btnUpload.disabled = false;
    }
  });

  // --- 렌더링 함수 ---

  function getPageEntries() {
    const pending = allEntries.filter(e => !e.uploaded);
    const start = currentPage * PAGE_SIZE;
    return pending.slice(start, start + PAGE_SIZE);
  }

  function renderPage(page) {
    const pending = allEntries.filter(e => !e.uploaded);
    const totalPages = Math.ceil(pending.length / PAGE_SIZE);
    currentPage = Math.min(page, Math.max(0, totalPages - 1));

    const start = currentPage * PAGE_SIZE;
    const pageEntries = pending.slice(start, start + PAGE_SIZE);

    entriesList.innerHTML = '';
    pageEntries.forEach((entry) => {
      const globalIdx = allEntries.indexOf(entry);
      const div = document.createElement('div');
      div.className = 'entry-item';
      div.innerHTML = `
        <span class="entry-date">${CardParserUtils.formatDate(entry.entry_date)}</span>
        <div class="entry-name-wrap">
          <input type="text" class="entry-name-input" data-idx="${globalIdx}"
                 value="${escapeAttr(entry.item)}" title="${escapeAttr(entry.item)}" autocomplete="off">
          <div class="autocomplete-list"></div>
        </div>
        <input type="text" class="entry-money-input${entry.money < 0 ? ' negative' : ''}" data-idx="${globalIdx}"
               value="${formatMoney(entry.money)}">
        <button class="entry-delete-btn" data-idx="${globalIdx}" title="삭제">&times;</button>
        <div class="entry-accounts"></div>
      `;
      entriesList.appendChild(div);
    });

    // 삭제 버튼
    entriesList.querySelectorAll('.entry-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        allEntries.splice(idx, 1);
        renderPage(currentPage);
      });
    });

    // 아이템명 변경 + 자동완성
    entriesList.querySelectorAll('.entry-name-input').forEach(input => {
      const acList = input.nextElementSibling;

      input.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (query.length < 1) { acList.classList.remove('show'); return; }
        const matches = Object.keys(itemAccountMap)
          .filter(name => name.toLowerCase().includes(query))
          .slice(0, 20);
        if (matches.length === 0) { acList.classList.remove('show'); return; }
        acList.innerHTML = matches.map(name => {
          const hl = highlightMatch(name, query);
          return `<div class="autocomplete-item" data-name="${escapeAttr(name)}">${hl}</div>`;
        }).join('');
        acList.classList.add('show');
      });

      input.addEventListener('blur', () => {
        setTimeout(() => {
          acList.classList.remove('show');
          commitItemName(input);
        }, 150);
      });

      input.addEventListener('keydown', (e) => {
        const items = acList.querySelectorAll('.autocomplete-item');
        const active = acList.querySelector('.autocomplete-item.active');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          let next;
          if (!active) {
            next = e.key === 'ArrowDown' ? items[0] : items[items.length - 1];
          } else {
            active.classList.remove('active');
            const idx = [...items].indexOf(active);
            next = e.key === 'ArrowDown' ? items[idx + 1] || items[0] : items[idx - 1] || items[items.length - 1];
          }
          if (next) { next.classList.add('active'); next.scrollIntoView({ block: 'nearest' }); }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (active) {
            input.value = active.dataset.name;
            acList.classList.remove('show');
            commitItemName(input);
            input.blur();
          }
        } else if (e.key === 'Escape') {
          acList.classList.remove('show');
        }
      });

      acList.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.autocomplete-item');
        if (!item) return;
        input.value = item.dataset.name;
        acList.classList.remove('show');
        commitItemName(input);
      });
    });

    // 금액 변경 (blur 시 포맷 복원)
    entriesList.querySelectorAll('.entry-money-input').forEach(input => {
      input.addEventListener('focus', (e) => {
        e.target.value = allEntries[parseInt(e.target.dataset.idx)].money;
        e.target.select();
      });
      input.addEventListener('blur', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const isNeg = e.target.value.trim().startsWith('-');
        const raw = e.target.value.replace(/[^0-9]/g, '');
        const num = parseInt(raw);
        if (!isNaN(num) && num > 0) {
          allEntries[idx].money = isNeg ? -num : num;
        }
        e.target.value = formatMoney(allEntries[idx].money);
        e.target.classList.toggle('negative', allEntries[idx].money < 0);
      });
    });

    // 커스텀 계정 피커 생성
    entriesList.querySelectorAll('.entry-accounts').forEach(container => {
      const idx = parseInt(container.closest('.entry-item').querySelector('.entry-name-input').dataset.idx);
      const entry = allEntries[idx];

      const lPicker = createAccountPicker(entry.lAccountId, entry.entry_date, (val) => {
        entry.lAccountId = val;
        saveItemAccountMap([entry]);
      });
      const rPicker = createAccountPicker(entry.rAccountId, entry.entry_date, (val) => {
        entry.rAccountId = val;
        saveItemAccountMap([entry]);
      });
      lPicker.dataset.side = 'l';
      rPicker.dataset.side = 'r';
      lPicker.dataset.idx = idx;
      rPicker.dataset.idx = idx;
      container.appendChild(lPicker);
      container.appendChild(rPicker);
    });

    renderPagination(totalPages);
    updateCounts();
  }

  function renderPagination(totalPages) {
    pagination.innerHTML = '';
    if (totalPages <= 1) return;

    const prev = createPageBtn('<', currentPage > 0, () => renderPage(currentPage - 1));
    pagination.appendChild(prev);

    for (let i = 0; i < totalPages; i++) {
      const btn = createPageBtn(String(i + 1), true, () => renderPage(i));
      if (i === currentPage) btn.classList.add('active');
      pagination.appendChild(btn);
    }

    const next = createPageBtn('>', currentPage < totalPages - 1, () => renderPage(currentPage + 1));
    pagination.appendChild(next);
  }

  function createPageBtn(label, enabled, onClick) {
    const btn = document.createElement('button');
    btn.className = 'page-btn';
    btn.textContent = label;
    btn.disabled = !enabled;
    if (enabled) btn.addEventListener('click', onClick);
    return btn;
  }

  function updateCounts() {
    const pending = allEntries.filter(e => !e.uploaded);
    const pageEntries = getPageEntries();
    uploadCount.textContent = pageEntries.length;
    totalCount.textContent = pending.length;
    btnUpload.disabled = pageEntries.length === 0;
  }

  // --- 계정 옵션 (날짜 기반 필터링) ---

  function isAccountActiveOn(opt, dateNum) {
    if (!dateNum) return true;
    if (opt.openDate && dateNum < opt.openDate) return false;
    if (opt.closeDate && dateNum > opt.closeDate) return false;
    return true;
  }

  function todayYYYYMMDD() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function populateBulkSelects(defaultL, defaultR) {
    const today = todayYYYYMMDD();
    bulkLWrap.innerHTML = '';
    bulkRWrap.innerHTML = '';

    const lPicker = createAccountPicker(defaultL, today, (val) => {
      allEntries.forEach(e => { if (!e.uploaded) e.lAccountId = val; });
      renderPage(currentPage);
    });
    const rPicker = createAccountPicker(defaultR, today, (val) => {
      allEntries.forEach(e => { if (!e.uploaded) e.rAccountId = val; });
      renderPage(currentPage);
    });
    bulkLWrap.appendChild(lPicker);
    bulkRWrap.appendChild(rPicker);
  }


  function getAccountType(accountId) {
    const opt = accountOptions.find(o => o.value === accountId);
    return opt?.type || null;
  }

  // --- 데이터 로드 ---

  async function loadSections() {
    try {
      const data = await WhooingAPI.getSections();
      if (data.code === 200 && data.results) {
        const saved = await getStorage('lastSectionId');
        data.results.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.section_id;
          opt.textContent = s.title;
          if (s.section_id === saved) opt.selected = true;
          sectionSelect.appendChild(opt);
        });
      }
    } catch (e) { console.error('섹션 로드 실패:', e); }
  }

  async function loadAccountOptions() {
    const sectionId = sectionSelect.value;
    if (!sectionId) return;

    try {
      const data = await WhooingAPI.getAccounts(sectionId);
      if (data.code !== 200 || !data.results) return;

      accountOptions = [];
      const typeLabels = {
        assets: '자산', liabilities: '부채', capital: '순자산',
        expenses: '비용', income: '수익',
      };

      for (const [type, label] of Object.entries(typeLabels)) {
        const accounts = data.results[type] || [];
        for (const acc of accounts) {
          if (acc.type !== 'account') continue;
          accountOptions.push({
            value: acc.account_id,
            label: acc.title,
            type,
            groupLabel: label,
            openDate: acc.open_date || 0,
            closeDate: acc.close_date || 29991231,
          });
        }
      }
    } catch (e) { console.error('항목 로드 실패:', e); }
  }

  // 섹션 변경 시 항목 목록 다시 로드
  sectionSelect.addEventListener('change', async () => {
    setStorage('lastSectionId', sectionSelect.value);
    if (sectionSelect.value) {
      await loadAccountOptions();
      await loadItemAccountMap();
      populateBulkSelects('', '');
      if (allEntries.length > 0) {
        applyItemAccountDefaults(allEntries);
        renderPage(currentPage);
      }
    }
  });

  // --- 유틸 ---

  function resetAll() {
    pageInfoArea.style.display = '';
    scrapeArea.style.display = '';
    scrapeArea.querySelector('.hint').style.display = '';
    cardInfo.style.display = 'none';
    sectionArea.style.display = 'none';
    bulkAccountArea.style.display = 'none';
    entriesArea.style.display = 'none';
    progressSection.style.display = 'none';
    resultSection.style.display = 'none';
    progressFill.style.width = '0%';
    allEntries = [];
    currentPage = 0;
    initialTotal = 0;
  }

  let resultTimer = null;
  function showResult(msg, type) {
    if (resultTimer) { clearTimeout(resultTimer); resultTimer = null; }
    resultSection.style.display = 'block';
    resultMessage.className = `result-message ${type}`;
    resultMessage.innerHTML = escapeHtml(msg).replace(/\n/g, '<br>');
    const delay = type === 'error' ? 5000 : type === 'warning' ? 6000 : 3000;
    resultTimer = setTimeout(() => {
      resultSection.style.display = 'none';
      resultTimer = null;
    }, delay);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatMoney(amount) {
    return Number(amount).toLocaleString('ko-KR');
  }

  // --- 커스텀 계정 피커 ---

  function createAccountPicker(selectedId, filterDate, onChange) {
    const picker = document.createElement('div');
    picker.className = 'acc-picker';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acc-picker-btn' + (selectedId ? '' : ' unset');
    btn.textContent = getAccountLabel(selectedId) || '선택';

    const drop = document.createElement('div');
    drop.className = 'acc-picker-drop';

    const filtered = filterDate
      ? accountOptions.filter(opt => isAccountActiveOn(opt, filterDate))
      : accountOptions;

    let currentGroup = '';
    let grpItems = null;
    for (const opt of filtered) {
      if (opt.groupLabel && opt.groupLabel !== currentGroup) {
        const label = document.createElement('div');
        label.className = 'acc-grp-label';
        label.textContent = opt.groupLabel;
        drop.appendChild(label);
        grpItems = document.createElement('div');
        grpItems.className = 'acc-grp-items';
        drop.appendChild(grpItems);
        currentGroup = opt.groupLabel;
      }
      const chip = document.createElement('span');
      chip.className = 'acc-chip' + (opt.value === selectedId ? ' selected' : '');
      chip.textContent = opt.label;
      chip.dataset.value = opt.value;
      if (grpItems) grpItems.appendChild(chip);
    }

    drop.addEventListener('mousedown', (e) => {
      const chip = e.target.closest('.acc-chip');
      if (!chip) return;
      e.preventDefault();
      const val = chip.dataset.value;
      btn.textContent = chip.textContent;
      btn.classList.remove('unset');
      btn.classList.remove('open');
      drop.classList.remove('show');
      drop.querySelectorAll('.acc-chip.selected').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      picker._value = val;
      if (onChange) onChange(val);
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = drop.classList.contains('show');
      closeAllPickers();
      if (wasOpen) return;

      // 위/아래 방향 결정
      const rect = btn.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      drop.classList.remove('drop-up', 'drop-down');
      drop.classList.add(spaceBelow < 220 ? 'drop-up' : 'drop-down');

      btn.classList.add('open');
      drop.classList.add('show');
    });

    picker.appendChild(btn);
    picker.appendChild(drop);
    picker._value = selectedId || '';
    picker._btn = btn;
    return picker;
  }

  function getAccountLabel(accountId) {
    if (!accountId) return '';
    const opt = accountOptions.find(o => o.value === accountId);
    return opt?.label || '';
  }

  function closeAllPickers() {
    document.querySelectorAll('.acc-picker-drop.show').forEach(d => {
      d.classList.remove('show');
      d.previousElementSibling?.classList.remove('open');
    });
  }

  document.addEventListener('click', () => closeAllPickers());

  function commitItemName(input) {
    const idx = parseInt(input.dataset.idx);
    const newName = input.value.trim();
    allEntries[idx].item = newName;

    if (!allEntries[idx].lAccountId) {
      const mapped = itemAccountMap[newName];
      if (mapped) {
        if (mapped.l) allEntries[idx].lAccountId = mapped.l;
        if (mapped.r && !allEntries[idx].rAccountId) allEntries[idx].rAccountId = mapped.r;
        const row = input.closest('.entry-item');
        if (row) {
          const pickers = row.querySelectorAll('.acc-picker');
          pickers.forEach(p => {
            const side = p.dataset.side;
            const val = side === 'l' ? allEntries[idx].lAccountId : allEntries[idx].rAccountId;
            if (val && p._btn) {
              p._value = val;
              p._btn.textContent = getAccountLabel(val) || '선택';
              p._btn.classList.toggle('unset', !val);
            }
          });
        }
      }
    }
  }

  function highlightMatch(text, query) {
    const lower = text.toLowerCase();
    const start = lower.indexOf(query);
    if (start < 0) return escapeHtml(text);
    const before = text.substring(0, start);
    const match = text.substring(start, start + query.length);
    const after = text.substring(start + query.length);
    return escapeHtml(before) + '<span class="ac-match">' + escapeHtml(match) + '</span>' + escapeHtml(after);
  }

  // --- 아이템명 → 계정 매핑 ---

  async function loadItemAccountMap() {
    const sectionId = sectionSelect.value;
    if (!sectionId) { itemAccountMap = {}; return; }

    // 1. 로컬 저장소에서 기존 매핑 로드
    itemAccountMap = (await getStorage(`itemAccountMap_${sectionId}`)) || {};

    // 2. 후잉 API에서 최근 사용 아이템 조회하여 보충 (로컬에 없는 것만)
    try {
      const data = await WhooingAPI.getLatestItems(sectionId);
      if (data.code === 200 && data.results) {
        let added = false;
        for (const entry of data.results) {
          const name = entry.item;
          if (!name || itemAccountMap[name]) continue;
          itemAccountMap[name] = {
            l: entry.l_account_id || '',
            r: entry.r_account_id || '',
          };
          added = true;
        }
        if (added) {
          await setStorageAsync(`itemAccountMap_${sectionId}`, itemAccountMap);
        }
      }
    } catch (e) { /* API 실패 시 로컬 매핑만 사용 */ }
  }

  async function saveItemAccountMap(entries) {
    const sectionId = sectionSelect.value;
    if (!sectionId) return;
    for (const e of entries) {
      if (e.item && e.lAccountId) {
        itemAccountMap[e.item] = { l: e.lAccountId, r: e.rAccountId || '' };
      }
    }
    await setStorageAsync(`itemAccountMap_${sectionId}`, itemAccountMap);
  }

  function applyItemAccountDefaults(entries) {
    for (const e of entries) {
      const mapped = itemAccountMap[e.item];
      if (mapped) {
        if (mapped.l) e.lAccountId = mapped.l;
        if (mapped.r) e.rAccountId = mapped.r;
      }
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function getStorage(key) { return new Promise(r => chrome.storage.local.get([key], res => r(res[key]))); }
  function setStorage(key, val) { chrome.storage.local.set({ [key]: val }); }
  function setStorageAsync(key, val) { return new Promise(r => chrome.storage.local.set({ [key]: val }, r)); }
});
