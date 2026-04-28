'use strict';

/**
 * nlp-engine.js
 * Natural Language Processing engine for the VA chatbot.
 * Converts free-form text into structured intents and entities.
 *
 * @module chatbot/nlp-engine
 */

/** @typedef {{ type: string, entities: Object, confidence: number }} IntentResult */
/** @typedef {{ symbol?: string, period?: string, strategyName?: string, exportType?: string }} Entities */

class NLPEngine {
  constructor() {
    /** Intent pattern registry: each entry has patterns (regex[]) and handler */
    this.intentPatterns = this.buildIntentPatterns();
    /** Common ticker symbols for entity extraction */
    this.knownTickers = new Set([
      'AAPL','TSLA','MSFT','NVDA','AMZN','GOOG','GOOGL','META','NFLX','AMD',
      'SPY','QQQ','IWM','DIA','GLD','TLT','VIX','COIN','MSTR','HOOD',
      'PLTR','RIVN','LCID','SOFI','RBLX','SNAP','UBER','LYFT','ABNB','DASH',
    ]);
  }

  /**
   * Build regex patterns for each intent type.
   * @returns {Array<{type: string, patterns: RegExp[], confidence: number}>}
   */
  buildIntentPatterns() {
    return [
      {
        type: 'should_buy',
        patterns: [
          /should\s+i\s+(buy|purchase|get|grab|pick up)/i,
          /is\s+(?:it\s+)?(?:a\s+)?good\s+(?:time\s+)?to\s+buy/i,
          /worth\s+buying/i,
          /buy\s+signal/i,
          /should\s+i\s+go\s+long/i,
        ],
        confidence: 0.9,
      },
      {
        type: 'best_stock_today',
        patterns: [
          /best\s+stock\s+to\s+(?:trade|buy|watch)/i,
          /top\s+(?:stocks|picks|plays|opportunities)\s+(?:today|now|this\s+week)/i,
          /what(?:'s|\s+is)\s+(?:hot|moving|popping)\s+today/i,
          /best\s+(?:setup|play|trade)\s+today/i,
          /scan\s+(?:the\s+)?market\s+for\s+(?:me|opportunities)/i,
          /what\s+should\s+i\s+(?:trade|buy)\s+today/i,
        ],
        confidence: 0.88,
      },
      {
        type: 'performance_query',
        patterns: [
          /how\s+(?:did|was|have)\s+(?:i|we|it|yesterday|today|this\s+week|this\s+month|last\s+(?:week|month|year))/i,
          /(?:show|give|tell)\s+(?:me\s+)?(?:my\s+)?(?:performance|results|stats|p&?l|profit)/i,
          /how(?:'m|\s+am)\s+i\s+doing/i,
          /what(?:'s|\s+is)\s+my\s+(?:p&?l|profit|loss|win\s+rate)/i,
          /yesterday(?:'s)?\s+(?:performance|results|trades)/i,
        ],
        confidence: 0.87,
      },
      {
        type: 'custom_backtest',
        patterns: [
          /(?:run|test|backtest|back\s*test)\s+(?:a\s+)?(?:strategy|this)/i,
          /test\s+(?:this\s+)?strategy/i,
          /what\s+if\s+(?:i\s+)?(?:buy|sell|traded)/i,
          /(?:how\s+would|would)\s+(?:this\s+)?strategy\s+(?:have\s+)?perform/i,
        ],
        confidence: 0.85,
      },
      {
        type: 'strategy_describe',
        patterns: [
          /(?:buy|go\s+long)\s+(?:when|at|above|below|on)/i,
          /(?:sell|go\s+short|exit)\s+(?:when|at|above|below|on)/i,
          /(?:strategy|system)\s*:/i,
          /(?:entry|exit)\s+(?:rule|signal|condition)/i,
          /moving\s+average\s+cross/i,
          /\d+[-\s]?(?:day|period|bar)\s+(?:ma|ema|sma|moving\s+average)/i,
        ],
        confidence: 0.82,
      },
      {
        type: 'trade_history',
        patterns: [
          /show\s+(?:me\s+)?(?:all\s+)?(?:my\s+)?(?:trades|history|positions)/i,
          /trade\s+history/i,
          /(?:past|previous|last|recent)\s+(?:\d+\s+)?(?:trades|transactions)/i,
          /what\s+(?:did\s+i|have\s+i)\s+traded?/i,
          /(?:all|list)\s+(?:my\s+)?(?:\w+\s+)?trades/i,
        ],
        confidence: 0.86,
      },
      {
        type: 'market_scan',
        patterns: [
          /scan\s+(?:the\s+)?market/i,
          /(?:any|show)\s+(?:breakout|momentum|setup|alert)/i,
          /what(?:'s|\s+is)\s+(?:the\s+)?market\s+doing/i,
          /market\s+(?:scan|sweep|overview)/i,
        ],
        confidence: 0.84,
      },
      {
        type: 'optimize_strategy',
        patterns: [
          /optimiz(?:e|ation)\s+(?:my\s+)?(?:strategy|parameters|params)/i,
          /improve\s+(?:my\s+)?strategy/i,
          /(?:tune|tweak|adjust)\s+(?:my\s+)?(?:strategy|parameters)/i,
          /make\s+(?:my\s+)?strategy\s+better/i,
        ],
        confidence: 0.83,
      },
      {
        type: 'position_size',
        patterns: [
          /how\s+(?:many|much)\s+(?:shares|contracts)\s+(?:should|do)\s+i/i,
          /position\s+siz(?:e|ing)/i,
          /kelly\s+(?:criterion|formula)/i,
          /how\s+big\s+(?:should|a)\s+(?:my\s+)?position/i,
        ],
        confidence: 0.88,
      },
      {
        type: 'risk_report',
        patterns: [
          /(?:daily\s+)?risk\s+report/i,
          /how\s+much\s+(?:am\s+i\s+)?(?:at\s+)?risk/i,
          /(?:capital|money)\s+at\s+risk/i,
          /(?:max|maximum)\s+(?:loss|drawdown)\s+today/i,
        ],
        confidence: 0.87,
      },
      {
        type: 'export_data',
        patterns: [
          /export\s+(?:to\s+)?(?:csv|pdf|excel)/i,
          /download\s+(?:my\s+)?(?:trades|data|report)/i,
          /(?:generate|create)\s+(?:a\s+)?(?:csv|pdf|report)/i,
          /tax\s+(?:export|report|data)/i,
        ],
        confidence: 0.90,
      },
      {
        type: 'help',
        patterns: [
          /^\s*help\s*$/i,
          /what\s+can\s+(?:you|i)\s+(?:do|ask)/i,
          /show\s+(?:me\s+)?(?:commands|options|features)/i,
          /how\s+do\s+i\s+use/i,
        ],
        confidence: 0.95,
      },
      {
        type: 'greeting',
        patterns: [
          /^\s*(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|howdy|what'?s\s+up)\s*[!.]*\s*$/i,
        ],
        confidence: 0.95,
      },
    ];
  }

  /**
   * Parse user message into a structured intent with entities.
   * @param {string} message - Raw user message
   * @param {Object} [context={}] - Session context for fallback entity resolution
   * @returns {IntentResult}
   */
  parseIntent(message, context = {}) {
    const normalizedMessage = message.trim().toLowerCase();

    for (const { type, patterns, confidence } of this.intentPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          const entities = this.extractEntities(message, context);
          return { type, entities, confidence, rawMessage: message };
        }
      }
    }

    // Unknown intent - check if it contains a ticker with no other context
    const entities = this.extractEntities(message, context);
    if (entities.symbol && normalizedMessage.includes(entities.symbol.toLowerCase())) {
      return {
        type: 'should_buy',
        entities,
        confidence: 0.5,
        rawMessage: message,
      };
    }

    return { type: 'unknown', entities, confidence: 0.1, rawMessage: message };
  }

  /**
   * Extract named entities (symbol, period, strategy name) from text.
   * @param {string} message
   * @param {Object} [context={}]
   * @returns {Entities}
   */
  extractEntities(message, context = {}) {
    const entities = {};

    // Symbol extraction: look for known tickers or $TICKER pattern
    const dollarTickerMatch = message.match(/\$([A-Z]{1,5})/);
    if (dollarTickerMatch) {
      entities.symbol = dollarTickerMatch[1].toUpperCase();
    } else {
      const upperMessage = message.toUpperCase();
      for (const ticker of this.knownTickers) {
        const tickerRegex = new RegExp('\\b' + ticker + '\\b');
        if (tickerRegex.test(upperMessage)) {
          entities.symbol = ticker;
          break;
        }
      }
    }

    // Period extraction
    const periodPatterns = [
      { pattern: /\byesterday\b/i, value: 'yesterday' },
      { pattern: /\btoday\b/i, value: 'today' },
      { pattern: /\bthis\s+week\b/i, value: 'this week' },
      { pattern: /\blast\s+week\b/i, value: 'last week' },
      { pattern: /\bthis\s+month\b/i, value: 'this month' },
      { pattern: /\blast\s+month\b/i, value: 'last month' },
      { pattern: /\blast\s+year\b/i, value: 'last year' },
      { pattern: /\blast\s+(\d+)\s+days?\b/i, value: null, capture: 1 },
    ];

    for (const { pattern, value, capture } of periodPatterns) {
      const match = message.match(pattern);
      if (match) {
        entities.period = capture ? `last ${match[capture]} days` : value;
        break;
      }
    }

    // Export type
    const exportMatch = message.match(/\b(csv|pdf|excel|xlsx)\b/i);
    if (exportMatch) entities.exportType = exportMatch[1].toLowerCase();

    // Strategy name
    const strategyMatch = message.match(/(?:strategy|system)\s+(?:called|named|")?([A-Za-z][A-Za-z\s]+?)(?:"|\s+strategy|$)/i);
    if (strategyMatch) entities.strategyName = strategyMatch[1].trim();

    return entities;
  }

  /**
   * Parse a strategy description from free-form text into structured parameters.
   * @param {string} text - User's strategy description
   * @returns {StrategyParams}
   */
  parseStrategyFromText(text) {
    const params = {
      name: 'Custom Strategy',
      entrySignal: 'unknown',
      exitSignal: 'unknown',
      entryPeriod: null,
      exitPeriod: null,
      entryType: 'MA',
      exitType: 'MA',
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      symbols: ['SPY'],
    };

    // Extract MA periods: "50-day MA", "20-period EMA", etc.
    const maPeriods = [...text.matchAll(/(\d+)[-\s]?(?:day|period|bar)?\s+(?:ma|ema|sma|moving\s+average)/gi)];
    if (maPeriods.length >= 1) {
      params.entryPeriod = parseInt(maPeriods[0][1], 10);
      params.entryType = text.match(/ema/i) ? 'EMA' : 'SMA';
      params.entrySignal = `price_crosses_above_${params.entryPeriod}_${params.entryType}`;
    }
    if (maPeriods.length >= 2) {
      params.exitPeriod = parseInt(maPeriods[1][1], 10);
      params.exitType = params.entryType;
      params.exitSignal = `price_crosses_below_${params.exitPeriod}_${params.exitType}`;
    }

    // Detect RSI strategy
    const rsiMatch = text.match(/rsi\s*(?:below|under|<|crosses?\s+below)?\s*(\d+)/i);
    if (rsiMatch) {
      params.entrySignal = `rsi_oversold_${rsiMatch[1]}`;
      params.entryType = 'RSI';
      params.entryPeriod = parseInt(rsiMatch[1], 10);
    }

    // Detect breakout strategy
    if (/breakout|break\s+out|new\s+high/i.test(text)) {
      params.entrySignal = 'breakout_above_resistance';
      params.entryType = 'BREAKOUT';
    }

    // Extract stop loss
    const stopMatch = text.match(/stop\s*(?:loss)?\s*(?:at|of|@)?\s*(\d+(?:\.\d+)?)%?/i);
    if (stopMatch) params.stopLossPercent = parseFloat(stopMatch[1]) / 100;

    // Extract take profit
    const tpMatch = text.match(/(?:take\s+profit|target|tp)\s*(?:at|of|@)?\s*(\d+(?:\.\d+)?)%?/i);
    if (tpMatch) params.takeProfitPercent = parseFloat(tpMatch[1]) / 100;

    // Extract symbols
    const symbolsInText = [];
    const upperText = text.toUpperCase();
    for (const ticker of this.knownTickers) {
      if (new RegExp('\\b' + ticker + '\\b').test(upperText)) {
        symbolsInText.push(ticker);
      }
    }
    if (symbolsInText.length) params.symbols = symbolsInText;

    // Generate descriptive name
    if (params.entryPeriod && params.exitPeriod) {
      params.name = `${params.entryPeriod}/${params.exitPeriod} ${params.entryType} Crossover`;
    } else if (params.entryType === 'RSI') {
      params.name = `RSI Oversold Reversal`;
    } else if (params.entryType === 'BREAKOUT') {
      params.name = `Breakout Strategy`;
    }

    return params;
  }
}

module.exports = NLPEngine;
