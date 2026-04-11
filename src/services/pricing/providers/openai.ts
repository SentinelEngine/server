import got from 'got';
import * as cheerio from 'cheerio';
import { getCachedPricing, setCachedPricing } from '../cache.js';

export interface OpenAIPricing {
  model:              string;
  inputPer1kTokens:  number;
  outputPer1kTokens: number;
  contextWindow:      number;
  fetchedAt:          string;
}

const FALLBACK: Record<string, Omit<OpenAIPricing, 'fetchedAt'>> = {
  'gpt-4o':                  { model: 'gpt-4o',                  inputPer1kTokens: 0.005,    outputPer1kTokens: 0.015,   contextWindow: 128000 },
  'gpt-4o-mini':             { model: 'gpt-4o-mini',             inputPer1kTokens: 0.00015,  outputPer1kTokens: 0.0006,  contextWindow: 128000 },
  'gpt-4-turbo':             { model: 'gpt-4-turbo',             inputPer1kTokens: 0.01,     outputPer1kTokens: 0.03,    contextWindow: 128000 },
  'gpt-4':                   { model: 'gpt-4',                   inputPer1kTokens: 0.03,     outputPer1kTokens: 0.06,    contextWindow: 8192   },
  'gpt-3.5-turbo':           { model: 'gpt-3.5-turbo',           inputPer1kTokens: 0.0005,   outputPer1kTokens: 0.0015,  contextWindow: 16385  },
  'text-embedding-3-small':  { model: 'text-embedding-3-small',  inputPer1kTokens: 0.00002,  outputPer1kTokens: 0,       contextWindow: 8191   },
  'text-embedding-3-large':  { model: 'text-embedding-3-large',  inputPer1kTokens: 0.00013,  outputPer1kTokens: 0,       contextWindow: 8191   },
};

export async function fetchOpenAIPricing(): Promise<Record<string, OpenAIPricing>> {
  const cacheKey = 'openai:all';
  const cached = await getCachedPricing<Record<string, OpenAIPricing>>(cacheKey);
  if (cached) return cached;

  try {
    const html = await got('https://openai.com/api/pricing', {
      timeout: { request: 10_000 },
      headers: { 'User-Agent': 'cloud-cost-analyzer/1.0' },
    }).text();

    const $ = cheerio.load(html);
    const result: Record<string, OpenAIPricing> = {};

    $('table').each((_, table) => {
      $(table).find('tr').each((_, row) => {
        const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
        if (cells.length >= 3) {
          const rawModel = cells[0].toLowerCase().replace(/\s+/g, '-');
          const input    = parseUSD(cells[1]);
          const output   = parseUSD(cells[2]);
          if (input !== null && output !== null) {
            // Try to match against known model aliases
            for (const [key] of Object.entries(FALLBACK)) {
              if (rawModel.includes(key.replace(/-/g, ' ').replace(/-/g, ''))) {
                result[key] = {
                  ...FALLBACK[key],
                  inputPer1kTokens:  input,
                  outputPer1kTokens: output,
                  fetchedAt:         new Date().toISOString(),
                };
              }
            }
          }
        }
      });
    });

    // Fill gaps with fallback
    for (const [m, f] of Object.entries(FALLBACK)) {
      if (!result[m]) result[m] = { ...f, fetchedAt: 'fallback' };
    }

    await setCachedPricing(cacheKey, result);
    return result;
  } catch {
    return Object.fromEntries(
      Object.entries(FALLBACK).map(([k, v]) => [k, { ...v, fetchedAt: 'fallback' }]),
    );
  }
}

function parseUSD(text: string): number | null {
  const match = text.match(/\$([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}
