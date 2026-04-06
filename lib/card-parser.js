/**
 * 카드 명세서 파싱 공통 유틸리티
 * 개별 카드사 파서(parsers/*)에서 참조
 */
const CardParserUtils = (() => {

  function parseDate(dateStr) {
    if (!dateStr) return null;
    dateStr = dateStr.trim().replace(/\s+/g, '');

    if (/^\d{8}$/.test(dateStr)) return parseInt(dateStr, 10);

    let match = dateStr.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
    if (match) {
      const [, y, m, d] = match;
      return parseInt(`${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`, 10);
    }

    // MM/DD 또는 MM.DD (올해)
    match = dateStr.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
    if (match) {
      const year = new Date().getFullYear();
      const [, m, d] = match;
      return parseInt(`${year}${m.padStart(2, '0')}${d.padStart(2, '0')}`, 10);
    }

    // YYYY.MM.DD with extra text around
    match = dateStr.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (match) {
      const [, y, m, d] = match;
      return parseInt(`${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`, 10);
    }

    return null;
  }

  function parseMoney(moneyStr) {
    if (!moneyStr) return null;
    const cleaned = moneyStr.replace(/[,원₩\s\u00a0]/g, '').replace(/^-/, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : Math.abs(num);
  }

  function formatDate(dateNum) {
    const s = String(dateNum);
    return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`;
  }

  function formatMoney(amount) {
    return Number(amount).toLocaleString('ko-KR');
  }

  /**
   * 텍스트 줄 기반 파싱 (fallback)
   */
  function parseTextLines(text) {
    if (!text) return [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const entries = [];

    for (const line of lines) {
      let parts = line.split('\t').map(p => p.trim()).filter(p => p);
      if (parts.length < 3) parts = line.split(/\s{2,}/).map(p => p.trim()).filter(p => p);
      if (parts.length < 3) parts = line.split(',').map(p => p.trim()).filter(p => p);
      if (parts.length < 3) continue;

      const dateCandidate = parseDate(parts[0]);
      if (!dateCandidate) continue;

      const moneyCandidate = parseMoney(parts[parts.length - 1]);
      if (!moneyCandidate) continue;

      const itemName = parts.slice(1, parts.length - 1).join(' ');
      if (!itemName) continue;

      entries.push({ entry_date: dateCandidate, item: itemName, money: moneyCandidate });
    }
    return entries;
  }

  return { parseDate, parseMoney, formatDate, formatMoney, parseTextLines };
})();
