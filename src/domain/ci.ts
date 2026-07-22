export interface CiFailureReport {
  buildUrl: string;
  logExcerpt: string;
}

export interface CiFeedbackReader {
  readFailure(buildUrl: string): Promise<CiFailureReport>;
}
