/**
 * 삼성카드 페이지의 '더보기' 버튼을 반복 클릭하여 전체 항목을 로드한다.
 * popup.js에서 scrapePageTables() 호출 전에 실행한다.
 */
async function loadAllSamsungItems() {
  if (!location.href.includes('samsungcard.com')
    && !document.documentElement.outerHTML.substring(0, 5000).includes('samsungcard')) {
    return { loaded: false, clicks: 0 };
  }

  let totalClicks = 0;
  const maxRounds = 100;

  for (let round = 0; round < maxRounds; round++) {
    const moreButtons = findSamsungMoreButtons();
    if (moreButtons.length === 0) break;

    for (const btn of moreButtons) {
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      totalClicks++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  window.scrollTo(0, 0);
  return { loaded: true, clicks: totalClicks };
}

/**
 * 삼성카드 페이지에서 목록 하단의 '더보기' 버튼만 찾는다.
 * 개별 항목의 상세보기(∨) 버튼은 제외한다.
 */
function findSamsungMoreButtons() {
  const candidates = document.querySelectorAll('button, a, [role="button"], [onclick]');
  const result = [];
  for (const el of candidates) {
    const ownText = el.textContent.trim();
    if (!/더\s*보기/.test(ownText)) continue;
    // "더보기"만 포함된 짧은 텍스트여야 함 (개별 항목 내부 버튼 제외)
    if (ownText.length > 20) continue;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
    if (el.disabled) continue;

    // 개별 거래 항목 내부의 버튼인지 확인 — 가까운 부모에 날짜+금액이 있으면 항목 내부
    let isInsideItem = false;
    let parent = el.parentElement;
    for (let d = 0; d < 4 && parent; d++) {
      const pt = parent.innerText || '';
      if (pt.length < 500 && /\d{2}\.\s*\d{1,2}\.\s*\d{1,2}/.test(pt) && /[0-9,]+원/.test(pt)) {
        isInsideItem = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (isInsideItem) continue;

    // 해외이용 섹션의 더보기는 클릭하지 않음 (중복 방지)
    const ancestor = el.closest('[class*="section"], [class*="area"], [id]');
    const ancestorText = ancestor?.textContent?.substring(0, 300) || '';
    if (/해외\s*이용/.test(ancestorText)) continue;

    result.push(el);
  }
  return result;
}

/**
 * 현재 페이지의 데이터를 추출.
 * chrome.scripting.executeScript()로 활성 탭에 주입되어 실행된다.
 *
 * 카드사별 추출 전략:
 *   현대카드 - JS 변수 arUseDesc 에서 직접 추출
 *   삼성카드 - bill.samsungcard.com 렌더링 후 DOM 테이블 추출
 *   기타     - 범용 테이블 추출
 */
function scrapePageTables() {
  const pageUrl = location.href;
  const pageTitle = document.title;
  const htmlSnippet = document.documentElement.outerHTML.substring(0, 5000);

  const result = {
    tables: [],
    pageText: '',
    html: htmlSnippet,
    url: pageUrl,
    title: pageTitle,
    hyundaiData: null,
    samsungData: null,
    needsAuth: false,
  };

  // VestMail 보안메일 감지 (DOM 기반)
  const decForm = document.getElementById('decForm');
  const passwordInput = document.getElementById('password');
  const isVestMail = !!(decForm || passwordInput
    || htmlSnippet.includes('vestmail') || htmlSnippet.includes('VestMail'));

  // --- 현대카드: JS 변수에서 직접 추출 (UseDesc가 있으면 복호화 완료 상태) ---
  const hyundaiEntries = extractHyundaiFromScript();
  if (hyundaiEntries && hyundaiEntries.length > 0) {
    result.hyundaiData = hyundaiEntries;
    return result;
  }

  // --- 삼성카드 감지 시 전용 파서만 사용 (범용 파서 차단) ---
  if (pageUrl.includes('samsungcard.com') || htmlSnippet.includes('samsungcard') || htmlSnippet.includes('삼성카드')) {
    const samsungEntries = extractSamsungFromDOM();
    if (samsungEntries && samsungEntries.length > 0) {
      result.samsungData = samsungEntries;
    }
    result.pageText = document.body.innerText;
    // "총 N건" — 해외이용 섹션 이전까지만 합산
    const foreignCut = result.pageText.search(/해외\s*이용\s*(상세|내역)/);
    const countText = foreignCut > 0 ? result.pageText.substring(0, foreignCut) : result.pageText;
    const totalMatches = countText.matchAll(/총\s*(\d+)\s*건/g);
    let expectedSum = 0;
    for (const m of totalMatches) expectedSum += parseInt(m[1]);
    if (expectedSum > 0) result.samsungExpectedCount = expectedSum;
    return result;
  }

  // VestMail 감지됐지만 카드 데이터를 못 찾은 경우 → 비밀번호 미입력 상태
  if (isVestMail && !result.hyundaiData && !result.samsungData) {
    result.needsAuth = true;
    return result;
  }

  // --- 범용: 모든 테이블 추출 ---
  const allTables = document.querySelectorAll('table');
  for (const table of allTables) {
    const headers = [];
    const rows = [];

    const thElements = table.querySelectorAll('thead th, thead td');
    if (thElements.length > 0) {
      thElements.forEach(th => headers.push(th.innerText.trim()));
    }

    const tbody = table.querySelector('tbody') || table;
    const trElements = tbody.querySelectorAll('tr');

    for (const tr of trElements) {
      if (tr.closest('thead')) continue;
      const cells = tr.querySelectorAll('td, th');
      if (cells.length === 0) continue;

      const row = [];
      cells.forEach(cell => row.push(cell.innerText.trim()));

      if (headers.length === 0 && rows.length === 0 && isHeaderRow(row)) {
        row.forEach(cell => headers.push(cell));
        continue;
      }
      if (row.every(cell => cell === '')) continue;
      rows.push(row);
    }

    if (rows.length > 0) {
      result.tables.push({ headers, rows });
    }
  }

  if (result.tables.length === 0) {
    result.pageText = document.body.innerText;
  }

  return result;
}

/**
 * 현대카드: <script> 내 arUseDesc[n] = new UseDesc(...) 패턴을 정규식으로 파싱
 */
function extractHyundaiFromScript() {
  let scriptText = '';

  // 메인 문서의 script 태그에서 탐색
  for (const s of document.querySelectorAll('script')) {
    if (s.textContent.includes('UseDesc') || s.textContent.includes('arUseDesc')) {
      scriptText += s.textContent;
    }
  }

  // VestMail 복호화 후 iframe 내부에 컨텐츠가 있을 수 있음
  if (!scriptText) {
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) continue;
        for (const s of iframeDoc.querySelectorAll('script')) {
          if (s.textContent.includes('UseDesc') || s.textContent.includes('arUseDesc')) {
            scriptText += s.textContent;
          }
        }
        if (scriptText) break;
      }
    } catch (e) { /* cross-origin iframe은 접근 불가 - 무시 */ }
  }

  if (!scriptText) return [];

  // new UseDesc(loop, 'YYMMDD','본인/가족', gf_Convert2ByteChar2('카드명'), gf_Convert2ByteChar2('가맹점'), '금액', ...)
  const regex = /new\s+UseDesc\s*\(\s*loop\s*,\s*'(\d{6})'\s*,\s*'([^']*)'\s*,\s*(?:gf_Convert2ByteChar2\()?'([^']*)'(?:\))?\s*,\s*(?:gf_Convert2ByteChar2\()?'([^']*)'(?:\))?\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/g;

  const entries = [];
  let match;
  while ((match = regex.exec(scriptText)) !== null) {
    const [, dateStr, useType, cardName, shop, useamt, div, divcnt, divamt] = match;
    // 빈 날짜 = 소계/합계 행 → 건너뜀
    if (!dateStr) continue;

    const year = 2000 + parseInt(dateStr.substring(0, 2));
    const month = dateStr.substring(2, 4);
    const day = dateStr.substring(4, 6);
    const entryDate = parseInt(`${year}${month}${day}`);

    const amount = parseInt((useamt || '0').replace(/,/g, ''));
    if (!amount || amount === 0) continue;

    entries.push({
      entry_date: entryDate,
      item: shop || cardName,
      money: Math.abs(amount),
      card: cardName,
      useType: useType,
    });
  }

  return entries;
}

/**
 * 삼성카드: 다중 전략으로 이용내역 추출
 *
 * Strategy 1: 메인 문서 텍스트 파싱
 * Strategy 2: iframe 내부 텍스트 파싱
 * Strategy 3: DOM 구조 기반 탐색 (금액+날짜 근접 요소)
 */
function extractSamsungFromDOM() {
  // Strategy 1: 메인 문서 텍스트
  let entries = parseSamsungText(document.body.innerText);
  if (entries.length > 0) return entries;

  // Strategy 2: iframe 내부
  try {
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iDoc?.body) continue;
        entries = parseSamsungText(iDoc.body.innerText);
        if (entries.length > 0) return entries;
      } catch (e) { continue; }
    }
  } catch (e) { /* cross-origin */ }

  // Strategy 3: DOM 기반 — 금액("원") 포함 요소 주변에서 날짜+가맹점 탐색
  entries = parseSamsungByDOM();
  if (entries.length > 0) return entries;

  return [];
}

/**
 * 삼성카드 텍스트 파싱 — 날짜("YY. M. D") 또는 금액("N,NNN원") 기준으로 탐색
 * 줄 순서와 배치가 다양할 수 있으므로 전/후방 모두 검색
 */
function parseSamsungText(text) {
  if (!text) return [];

  // "해외이용 상세정보" 섹션은 일시불/할부의 중복이므로 제외
  const foreignIdx = text.search(/해외\s*이용\s*(상세|내역)/);
  const targetText = foreignIdx > 0 ? text.substring(0, foreignIdx) : text;

  const lines = targetText.split('\n').map(l => l.trim()).filter(l => l);
  const entries = [];
  const usedLines = new Set();

  for (let i = 0; i < lines.length; i++) {
    // 삼성카드 날짜 형식: "YY. M. D" (줄 어디에든 가능)
    const dateMatch = lines[i].match(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (!dateMatch) continue;

    const year = 2000 + parseInt(dateMatch[1]);
    if (year < 2020 || year > 2099) continue;
    const month = parseInt(dateMatch[2]);
    const day = parseInt(dateMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const entryDate = year * 10000 + month * 100 + day;

    let merchantName = '';
    let amount = 0;

    // (A) 같은 줄에 금액이 있는 경우 (예: "주식회사 비케이알 21,400원 26. 3. 1")
    const sameLineAmt = lines[i].match(/-?\s*([0-9,]+)\s*원/);
    if (sameLineAmt) {
      amount = parseInt(sameLineAmt[1].replace(/,/g, ''));
      if (sameLineAmt[0].trim().startsWith('-')) amount = -amount;
      const beforeAmt = lines[i].substring(0, lines[i].indexOf(sameLineAmt[0])).trim();
      const beforeDate = lines[i].substring(0, lines[i].indexOf(dateMatch[0])).trim();
      merchantName = (beforeAmt || beforeDate).replace(/\s*-?\s*[0-9,]+\s*원.*$/, '').trim();
    }

    // (B) 이전 줄들에서 금액+가맹점 찾기 (가장 흔한 패턴)
    if (!merchantName || !amount) {
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (usedLines.has(j)) continue;
        const amtMatch = lines[j].match(/-?\s*([0-9,]+)\s*원/);
        if (!amtMatch) continue;
        let amt = parseInt(amtMatch[1].replace(/,/g, ''));
        if (!amt) continue;
        if (amtMatch[0].trim().startsWith('-')) amt = -amt;
        const name = lines[j].substring(0, lines[j].indexOf(amtMatch[0])).trim();
        if (name) {
          amount = amt;
          merchantName = name;
          usedLines.add(j);
          break;
        }
        if (j > 0 && !usedLines.has(j - 1) && !/-?\s*[0-9,]+\s*원/.test(lines[j - 1])) {
          const candidateName = lines[j - 1].trim();
          if (candidateName.length >= 2 && !/^(\d{2})\.\s*\d/.test(candidateName)) {
            amount = amt;
            merchantName = candidateName;
            usedLines.add(j);
            usedLines.add(j - 1);
            break;
          }
        }
      }
    }

    // (C) 이후 줄들에서 금액+가맹점 찾기
    if (!merchantName || !amount) {
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
        if (usedLines.has(j)) continue;
        const amtMatch = lines[j].match(/-?\s*([0-9,]+)\s*원/);
        if (!amtMatch) continue;
        let amt = parseInt(amtMatch[1].replace(/,/g, ''));
        if (!amt) continue;
        if (amtMatch[0].trim().startsWith('-')) amt = -amt;
        const name = lines[j].substring(0, lines[j].indexOf(amtMatch[0])).trim();
        if (name) {
          amount = amt;
          merchantName = name;
          usedLines.add(j);
          break;
        }
      }
    }

    if (!merchantName || amount === 0) continue;
    if (isSamsungNonTransaction(merchantName)) continue;
    if (merchantName.length < 2) continue;

    entries.push({ entry_date: entryDate, item: merchantName, money: amount });
    usedLines.add(i);
  }

  return entries;
}

/** 삼성카드 페이지의 요약/헤더/비거래 항목 필터링 */
function isSamsungNonTransaction(name) {
  return [
    /결제\s*금액/, /총\s*결제/, /청구\s*금액/, /결제\s*예정/,
    /^\(?\s*\d{4}년/, /\d{4}년.*월.*결제/, /\d{4}년\s*\d{1,2}~\d{1,2}월/,
    /^소계/, /^합계/, /^총\s/,
    /연회비|수수료|적립\s*포인트|캐시백|이월\s*금액|전월\s*실적/,
    /포인트.*소멸/, /다음\s*달\s*소멸/,
    /일시\s*결제/, /일시불\/할부/, /일자\s*순|금액\s*순|상세\s*조회/,
    /글자\s*크기/, /카드\s*이용\s*안내/,
  ].some(p => p.test(name));
}

/**
 * DOM 기반 삼성카드 파싱 — 리프 노드에서 금액 패턴을 찾고
 * 인접 요소에서 날짜와 가맹점명 추출
 */
function parseSamsungByDOM() {
  const entries = [];

  // 해외이용 섹션의 DOM 요소를 찾아 제외 대상으로 마킹
  const foreignSections = new Set();
  document.querySelectorAll('*').forEach(el => {
    if (/해외\s*이용\s*(상세|내역)/.test(el.textContent?.substring(0, 30) || '')) {
      foreignSections.add(el);
    }
  });

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const amountNodes = [];

  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    if (/^-?\s*[0-9,]+원$/.test(text)) {
      const num = parseInt(text.replace(/[^0-9]/g, ''));
      if (num > 0 && num < 100000000) {
        const amt = text.startsWith('-') ? -num : num;
        amountNodes.push({ node: walker.currentNode, amount: amt });
      }
    }
  }

  for (const { node, amount } of amountNodes) {
    // 해외이용 섹션 내부의 항목은 건너뛰기
    let inForeign = false;
    for (const sec of foreignSections) {
      if (sec.contains(node)) { inForeign = true; break; }
    }
    if (inForeign) continue;

    const card = node.parentElement?.closest('[class*="item"], [class*="list"], [class*="card"], [class*="row"], li, tr, dl')
      || node.parentElement?.parentElement?.parentElement;
    if (!card) continue;

    const cardText = card.innerText || '';
    const dateMatch = cardText.match(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (!dateMatch) continue;

    const year = 2000 + parseInt(dateMatch[1]);
    if (year < 2020 || year > 2099) continue;
    const entryDate = year * 10000 + parseInt(dateMatch[2]) * 100 + parseInt(dateMatch[3]);

    // 금액과 날짜를 제외한 텍스트에서 가맹점명 추출
    let merchantName = cardText
      .replace(/[0-9,]+\s*원/g, '')
      .replace(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/g, '')
      .replace(/(본\s*인|가\s*족)\s*\d{4}/g, '')
      .replace(/[∨>]/g, '')
      .split('\n').map(l => l.trim()).filter(l => l.length >= 2)[0];

    if (!merchantName || merchantName.length < 2) continue;
    if (isSamsungNonTransaction(merchantName)) continue;

    entries.push({ entry_date: entryDate, item: merchantName, money: amount });
  }

  return entries;
}

function isHeaderRow(row) {
  const keywords = [
    '날짜', '일자', '이용일', '거래일', '승인일', '매출일',
    '가맹점', '이용처', '상호', '내역', '적요',
    '금액', '이용금액', '거래금액', '승인금액', '결제금액',
  ];
  const text = row.join(' ').toLowerCase();
  return keywords.some(kw => text.includes(kw));
}
