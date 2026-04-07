/**
 * EDR (Endpoint Detection and Response) module
 */

export { detectEDR, hasSlowCoWEDR, getEDRSummary } from './detection.js';
export { detectCrowdStrike } from './crowdstrike.js';
