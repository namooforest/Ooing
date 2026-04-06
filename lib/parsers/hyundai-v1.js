/**
 * 현대카드 명세서 파서 v1
 *
 * 대상: 현대카드 이메일 명세서 (보안메일 복호화 후)
 * 구분자: hyundaicard.com, 현대카드, UseDesc
 *
 * 데이터 구조:
 *   이메일 HTML 내에 JavaScript 변수 arUseDesc[] 배열로 거래 데이터 존재
 *   new UseDesc(loop, 'YYMMDD', '본인/가족', card, shop, useamt, div, divcnt, divamt, ...)
 *   - usedate가 비어있고 shop에 '소계'/'합계' 포함 → 합계행 (제외)
 *
 * 변경 이력:
 *   v1.0 - 2026-04-06 - 초기 버전 (실제 명세서 구조 분석 기반)
 */
const HyundaiCardParserV1 = (() => {

  const VERSION = '1.0';

  /**
   * @param {Object} scrapedData - page-scraper 반환값
   * @returns {Array<{entry_date, item, money}>}
   */
  function parse(scrapedData) {
    // 1순위: page-scraper가 이미 추출한 현대카드 데이터
    if (scrapedData.hyundaiData && scrapedData.hyundaiData.length > 0) {
      return scrapedData.hyundaiData.map(e => ({
        entry_date: e.entry_date,
        item: e.item,
        money: e.money,
      }));
    }

    // 2순위: 테이블 기반 파싱 (fallback)
    if (scrapedData.tables && scrapedData.tables.length > 0) {
      return parseFromTables(scrapedData.tables);
    }

    // 3순위: 텍스트 파싱
    return CardParserUtils.parseTextLines(scrapedData.pageText || '');
  }

  function parseFromTables(tables) {
    let bestEntries = [];
    for (const table of tables) {
      const entries = parseTable(table);
      if (entries.length > bestEntries.length) bestEntries = entries;
    }
    return bestEntries;
  }

  function parseTable(table) {
    const { headers, rows } = table;
    const colMap = detectColumns(headers, rows);
    if (!colMap) return [];

    const startRow = colMap.skipFirstRow ? 1 : 0;
    const entries = [];
    for (let i = startRow; i < rows.length; i++) {
      const entry = extractEntry(rows[i], colMap);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  function detectColumns(headers, rows) {
    const DATE_KW = ['이용일', '거래일', '매출일', '승인일', '일자'];
    const ITEM_KW = ['이용가맹점', '이용처', '가맹점', '상호명', '내역', '가맹점명'];
    const MONEY_KW = ['이용금액', '매출금액', '결제금액', '금액', '이용 금액'];

    function matchRow(row) {
      let dateIdx = -1, itemIdx = -1, moneyIdx = -1;
      row.forEach((h, idx) => {
        const clean = h.replace(/\s/g, '');
        if (dateIdx < 0 && DATE_KW.some(kw => clean.includes(kw))) dateIdx = idx;
        if (itemIdx < 0 && ITEM_KW.some(kw => clean.includes(kw))) itemIdx = idx;
        if (moneyIdx < 0 && MONEY_KW.some(kw => clean.includes(kw))) moneyIdx = idx;
      });
      if (dateIdx >= 0 && itemIdx >= 0 && moneyIdx >= 0) return { date: dateIdx, item: itemIdx, money: moneyIdx };
      return null;
    }

    if (headers.length > 0) {
      const m = matchRow(headers);
      if (m) return m;
    }
    if (rows.length > 0) {
      const m = matchRow(rows[0]);
      if (m) return { ...m, skipFirstRow: true };
    }
    return null;
  }

  function extractEntry(row, colMap) {
    if (row.length <= Math.max(colMap.date, colMap.item, colMap.money)) return null;
    const dateVal = CardParserUtils.parseDate(row[colMap.date]);
    if (!dateVal) return null;
    const moneyVal = CardParserUtils.parseMoney(row[colMap.money]);
    if (!moneyVal || moneyVal === 0) return null;
    const item = row[colMap.item].trim();
    if (!item) return null;
    return { entry_date: dateVal, item, money: moneyVal };
  }

  return { VERSION, parse };
})();

CardParsers.registerParser('hyundai', HyundaiCardParserV1);
