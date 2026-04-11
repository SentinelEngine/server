import got from 'got';
import * as cheerio from 'cheerio';
import { getCachedPricing, setCachedPricing } from '../cache.js';

export interface AnthropicPricing {
  model:              string;
  inputPer1kTokens:  number;
  outputPer1kTokens: number;
  contextWindow:      number;
  fetchedAt:          string;
}

const FALLBACK: Record<string, Omit<AnthropicPricing, 'fetchedAt'>> = {
  'claude-3-5-sonnet': { model: 'claude-3-5-sonnet', inputPer1kTokens: 0.003,   outputPer1kTokens: 0.015,  contextWindow: 200000 },
  'claude-3-opus':     { model: 'claude-3-opus',     inputPer1kTokens: 0.015,   outputPer1kTokens: 0.075,  contextWindow: 200000 },
  'claude-3-sonnet':   { model: 'claude-3-sonnet',   inputPer1kTokens: 0.003,   outputPer1kTokens: 0.015,  contextWindow: 200000 },
  'claude-3-haiku':    { model: 'claude-3-haiku',    inputPer1kTokens: 0.00025, outputPer1kTokens: 0.00125, contextWindow: 200000 },
  'claude-2':          { model: 'claude-2',          inputPer1kTokens: 0.008,   outputPer1kTokens: 0.024,  contextWindow: 100000 },
  'claude-instant':    { model: 'claude-instant',    inputPer1kTokens: 0.0008,  outputPer1kTokens: 0.0024, contextWindow: 100000 },
};

export async function fetchAnthropicPricing(): Promise<Record<string, AnthropicPricing>> {
  const cacheKey = 'anthropic:all';
  const cached = await getCachedPricing<Record<string, AnthropicPricing>>(cacheKey);
  if (cached) return cached;

  try {
    const html = await got('https://www.anthropic.com/pricing', {
      timeout: { request: 10_000 },
      headers: { 'User-Agent': 'cloud-cost-analyzer/1.0' },
    }).text();

    const $ = cheerio.load(html);
    const result: Record<string, AnthropicPricing> = {};

    $('table').each((_, table) => {
      $(table).find('tr').each((_, row) => {
        const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
        if (cells.length >= 3) {
          const rawModel = cells[0].toLowerCase().replace(/\s+/g, '-');
          const input    = parseUSD(cells[1]);
          const output   = parseUSD(cells[2]);
          if (input !== null && output !== null) {
            for (const key of Object.keys(FALLBACK)) {
              if (rawModel.includes(key)) {
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
