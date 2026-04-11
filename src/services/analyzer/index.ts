/**
 * Analyzer orchestrator — thin re-export of analyzeCode from the AST walker.
 * Callers import from this module; the implementation detail (ast-walker) is
 * an internal concern of the analyzer package.
 */
export { analyzeCode } from './ast-walker.js';
export type { AnalysisResult, DetectionMatch, SupportedLanguage } from './types.js';
