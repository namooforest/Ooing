/**
 * 삼성카드 명세서 파서 v1
 *
 * 대상: 삼성카드 이메일 명세서 → bill.samsungcard.com 리다이렉트 후 페이지
 * 구분자: samsungcard.com, 삼성카드
 *
 * 이메일 명세서는 보안메일 복호화 후 bill.samsungcard.com으로 자동 리다이렉트됨.
 * 실제 이용내역은 리다이렉트 후 웹페이지의 DOM 테이블에 렌더링됨.
 *
 * 변경 이력:
 *   v1.0 - 2026-04-06 - 초기 버전 (리다이렉트 후 DOM 테이블 파싱)
 */
const SamsungCardParserV1 = (() => {

  const VERSION = '1.0';

  /**
   * @param {Object} scrapedData - page-scraper 반환값
   * @returns {Array<{entry_date, item, money}>}
   */
  function parse(scrapedData) {
    // 1순위: page-scraper가 이미 추출한 삼성카드 데이터
    if (scrapedData.samsungData && scrapedData.samsungData.length > 0) {
      return scrapedData.samsungData;
    }

    // 2순위: pageText에서 삼성카드 패턴으로 텍스트 파싱
    if (scrapedData.pageText) {
      const textEntries = parseSamsungPageText(scrapedData.pageText);
      if (textEntries.length > 0) return textEntries;
    }

    return [];
  }

  /**
   * 삼성카드 bill 페이지의 bodyText를 파싱
   * "YY. M. D" 날짜 패턴 + 금액("N,NNN원") 기반
   */
  function parseSamsungPageText(text) {
    // "해외이용 상세정보"는 일시불/할부의 중복이므로 제외
    const foreignIdx = text.search(/해외\s*이용\s*(상세|내역)/);
    const targetText = foreignIdx > 0 ? text.substring(0, foreignIdx) : text;

    const lines = targetText.split('\n').map(l => l.trim()).filter(l => l);
    const entries = [];
    const usedLines = new Set();

    for (let i = 0; i < lines.length; i++) {
      const dateMatch = lines[i].match(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
      if (!dateMatch) continue;
      const year = 2000 + parseInt(dateMatch[1]);
      if (year < 2020 || year > 2099) continue;
      const month = parseInt(dateMatch[2]);
      const day = parseInt(dateMatch[3]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const entryDate = year * 10000 + month * 100 + day;

      let merchantName = '', amount = 0;

      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (usedLines.has(j)) continue;
        const amtMatch = lines[j].match(/-?\s*([0-9,]+)\s*원/);
        if (!amtMatch) continue;
        let amt = parseInt(amtMatch[1].replace(/,/g, ''));
        if (!amt) continue;
        if (amtMatch[0].trim().startsWith('-')) amt = -amt;
        const name = lines[j].substring(0, lines[j].indexOf(amtMatch[0])).trim();
        if (name && name.length >= 2) { amount = amt; merchantName = name; usedLines.add(j); break; }
        if (j > 0 && !usedLines.has(j - 1)) {
          const candidateName = lines[j - 1].trim();
          if (candidateName.length >= 2 && !/(\d{2})\.\s*\d/.test(candidateName)) {
            amount = amt; merchantName = candidateName; usedLines.add(j); usedLines.add(j - 1); break;
          }
        }
      }
      if (!merchantName || amount === 0) continue;
      if (isSamsungSkip(merchantName)) continue;
      entries.push({ entry_date: entryDate, item: merchantName, money: amount });
      usedLines.add(i);
    }
    return entries;
  }

  function isSamsungSkip(name) {
    return [
      /결제\s*금액/, /총\s*결제/, /청구\s*금액/, /결제\s*예정/,
      /^\(?\s*\d{4}년/, /\d{4}년.*월.*결제/, /\d{4}년\s*\d{1,2}~\d{1,2}월/,
      /^소계/, /^합계/, /^총\s/,
      /연회비|수수료|적립\s*포인트|캐시백|이월|전월\s*실적/,
      /포인트.*소멸/, /일시\s*결제/, /일시불\/할부/,
      /일자\s*순|금액\s*순|상세\s*조회|글자\s*크기|카드\s*이용\s*안내/,
    ].some(p => p.test(name));
  }

  return { VERSION, parse };
})();

CardParsers.registerParser('samsung', SamsungCardParserV1);
