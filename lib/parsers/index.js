/**
 * 카드사 자동 감지 및 파서 라우터
 *
 * 지원 카드사:
 *   - 삼성카드 (samsung)
 *   - 현대카드 (hyundai)
 */
const CardParsers = (() => {

  const SUPPORTED_CARDS = {
    samsung: { name: '삼성카드', parser: null },
    hyundai: { name: '현대카드', parser: null },
  };

  function registerParser(cardId, parser) {
    if (SUPPORTED_CARDS[cardId]) {
      SUPPORTED_CARDS[cardId].parser = parser;
    }
  }

  /**
   * 페이지 정보를 기반으로 카드사 감지
   * @param {Object} pageInfo - { url, title, html, text }
   * @returns {{ cardId: string, cardName: string } | null}
   */
  function detectCard(pageInfo) {
    const { url = '', title = '', html = '', text = '' } = pageInfo;
    const combined = (url + ' ' + title + ' ' + html + ' ' + text).toLowerCase();

    if (combined.includes('samsungcard') || combined.includes('삼성카드')) {
      return { cardId: 'samsung', cardName: SUPPORTED_CARDS.samsung.name };
    }

    if (combined.includes('hyundaicard') || combined.includes('현대카드')) {
      return { cardId: 'hyundai', cardName: SUPPORTED_CARDS.hyundai.name };
    }

    return null;
  }

  /**
   * 감지된 카드사에 맞는 파서로 데이터 추출
   * @param {string} cardId
   * @param {Object} scrapedData - page-scraper에서 반환된 데이터
   * @returns {Array<{entry_date, item, money}>}
   */
  function parse(cardId, scrapedData) {
    const card = SUPPORTED_CARDS[cardId];
    if (!card || !card.parser) {
      throw new Error(`${cardId} 파서가 등록되지 않았습니다.`);
    }
    return card.parser.parse(scrapedData);
  }

  /**
   * 자동 감지 + 파싱 한번에
   */
  function detectAndParse(scrapedData) {
    // page-scraper가 카드사별 데이터를 직접 추출한 경우 우선 감지
    let detected = null;
    if (scrapedData.hyundaiData && scrapedData.hyundaiData.length > 0) {
      detected = { cardId: 'hyundai', cardName: SUPPORTED_CARDS.hyundai.name };
    } else if (scrapedData.samsungData && scrapedData.samsungData.length > 0) {
      detected = { cardId: 'samsung', cardName: SUPPORTED_CARDS.samsung.name };
    }

    if (!detected) {
      const pageInfo = {
        url: scrapedData.url || '',
        title: scrapedData.title || '',
        html: scrapedData.html || '',
        text: scrapedData.pageText || '',
      };
      detected = detectCard(pageInfo);
    }

    if (!detected) {
      return {
        success: false,
        error: 'unsupported',
        message: '지원하지 않는 카드사입니다.\n현재 삼성카드, 현대카드만 지원합니다.',
      };
    }

    try {
      const entries = parse(detected.cardId, scrapedData);
      return {
        success: true,
        cardId: detected.cardId,
        cardName: detected.cardName,
        parserVersion: SUPPORTED_CARDS[detected.cardId].parser.VERSION,
        entries,
      };
    } catch (err) {
      return {
        success: false,
        error: 'parse_error',
        cardId: detected.cardId,
        cardName: detected.cardName,
        message: `${detected.cardName} 명세서 파싱 실패: ${err.message}`,
      };
    }
  }

  function getSupportedCards() {
    return Object.entries(SUPPORTED_CARDS).map(([id, info]) => ({
      id,
      name: info.name,
      hasParser: !!info.parser,
      version: info.parser?.VERSION || null,
    }));
  }

  return {
    registerParser,
    detectCard,
    parse,
    detectAndParse,
    getSupportedCards,
  };
})();
