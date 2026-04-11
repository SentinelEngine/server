export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go';

export interface DetectionMatch {
  service:        string;
  model?:         string;
  operation?:     string;
  callsPerMonth?: number;
  inputTokens?:   number;
  outputTokens?:  number;
  memoryMB?:      number;
  durationMs?:    number;
  storageGB?:     number;
  line:           number;
  column:         number;
  snippet:        string;
}

export interface AnalysisResult {
  language:   SupportedLanguage;
  detections: DetectionMatch[];
  errors:     string[];
}

export type DetectorFn = (ast: any, code: string) => DetectionMatch[];
