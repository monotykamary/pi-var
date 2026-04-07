/**
 * Unit tests for EDR detection utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EDRDetectionResult } from '../../src/types/index';
import { hasSlowCoWEDR, getEDRSummary } from '../../src/edr/index';

describe('hasSlowCoWEDR', () => {
  it('should return true when known slow CoW EDR is detected', () => {
    const result: EDRDetectionResult = {
      detected: true,
      found: ['Falcon'],
      details: [{ process: 'Falcon', product: 'CrowdStrike Falcon', knownSlowCoW: true }],
    };

    expect(hasSlowCoWEDR(result)).toBe(true);
  });

  it('should return false when only non-slow EDR is detected', () => {
    const result: EDRDetectionResult = {
      detected: true,
      found: ['eset_daemon'],
      details: [{ process: 'eset_daemon', product: 'ESET', knownSlowCoW: false }],
    };

    expect(hasSlowCoWEDR(result)).toBe(false);
  });

  it('should return false when no EDR is detected', () => {
    const result: EDRDetectionResult = {
      detected: false,
      found: [],
      details: [],
    };

    expect(hasSlowCoWEDR(result)).toBe(false);
  });

  it('should return true when mix of slow and non-slow EDRs detected', () => {
    const result: EDRDetectionResult = {
      detected: true,
      found: ['Falcon', 'eset_daemon'],
      details: [
        { process: 'Falcon', product: 'CrowdStrike Falcon', knownSlowCoW: true },
        { process: 'eset_daemon', product: 'ESET', knownSlowCoW: false },
      ],
    };

    expect(hasSlowCoWEDR(result)).toBe(true);
  });
});

describe('getEDRSummary', () => {
  it('should return no detection message when no EDR found', () => {
    const result: EDRDetectionResult = {
      detected: false,
      found: [],
      details: [],
    };

    const summary = getEDRSummary(result);
    expect(summary).toBe('No EDR/AV software detected');
  });

  it('should list slow CoW EDRs first', () => {
    const result: EDRDetectionResult = {
      detected: true,
      found: ['Falcon', 'eset_daemon'],
      details: [
        { process: 'Falcon', product: 'CrowdStrike Falcon', knownSlowCoW: true },
        { process: 'eset_daemon', product: 'ESET', knownSlowCoW: false },
      ],
    };

    const summary = getEDRSummary(result);
    expect(summary).toContain('CoW-impacting EDR detected: CrowdStrike Falcon');
    expect(summary).toContain('Other security software: ESET');
  });

  it('should only list slow CoW EDRs when no others present', () => {
    const result: EDRDetectionResult = {
      detected: true,
      found: ['Falcon'],
      details: [{ process: 'Falcon', product: 'CrowdStrike Falcon', knownSlowCoW: true }],
    };

    const summary = getEDRSummary(result);
    expect(summary).toBe('CoW-impacting EDR detected: CrowdStrike Falcon');
  });

  it('should only list other EDRs when no slow ones present', () => {
    const result: EDRDetectionResult = {
      detected: true,
      found: ['eset_daemon', 'kav'],
      details: [
        { process: 'eset_daemon', product: 'ESET', knownSlowCoW: false },
        { process: 'kav', product: 'Kaspersky', knownSlowCoW: false },
      ],
    };

    const summary = getEDRSummary(result);
    expect(summary).toContain('Other security software:');
    expect(summary).toContain('ESET');
    expect(summary).toContain('Kaspersky');
    expect(summary).not.toContain('CoW-impacting');
  });

  it('should handle unknown EDR products', () => {
    const result: EDRDetectionResult = {
      detected: true,
      found: ['unknown_edr'],
      details: [{ process: 'unknown_edr', product: 'unknown_edr', knownSlowCoW: false }],
    };

    const summary = getEDRSummary(result);
    expect(summary).toContain('unknown_edr');
  });
});
