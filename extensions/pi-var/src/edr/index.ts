/**
 * EDR (Endpoint Detection and Response) module
 */

export { EDR_PROCESSES, EDR_INFO } from './constants.js';
export { detectEDR, hasSlowCoWEDR, getEDRSummary } from './detection.js';
export { detectCrowdStrike } from './crowdstrike.js';
export type { EDRDetectionResult, EDRDetails } from '../types/index.js';
