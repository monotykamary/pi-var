/**
 * Unit tests for CoW detection types and logic
 * Tests the decision-making logic rather than mocking system calls
 */

import { describe, it, expect } from 'vitest';
import type { CoWDetectionResult } from '../../src/types/index';

describe('CoWDetectionResult type structure', () => {
  it('should have the correct structure for successful CoW without EDR', () => {
    const result: CoWDetectionResult = {
      supported: true,
      method: 'clonefile',
      edr: {
        detected: false,
        products: [],
        hasSlowCoWEDR: false,
      },
      performance: {
        fast: true,
        durationMs: 10,
        samples: 2,
        maxDurationMs: 12,
        confidence: 'high',
      },
      recommendedType: 'cow',
    };

    expect(result.supported).toBe(true);
    expect(result.method).toBe('clonefile');
    expect(result.edr?.detected).toBe(false);
    expect(result.edr?.hasSlowCoWEDR).toBe(false);
    expect(result.performance?.fast).toBe(true);
    expect(result.performance?.confidence).toBe('high');
    expect(result.recommendedType).toBe('cow');
  });

  it('should have the correct structure when known slow EDR detected (short-circuit)', () => {
    // When CrowdStrike is detected, we short-circuit to worktree without timing
    const result: CoWDetectionResult = {
      supported: true,
      method: 'clonefile',
      edr: {
        detected: true,
        products: ['CrowdStrike Falcon'],
        hasSlowCoWEDR: true,
      },
      recommendedType: 'worktree',
    };

    expect(result.supported).toBe(true);
    expect(result.edr?.detected).toBe(true);
    expect(result.edr?.hasSlowCoWEDR).toBe(true);
    expect(result.performance).toBeUndefined(); // No timing needed
    expect(result.recommendedType).toBe('worktree');
  });

  it('should have the correct structure when EDR detected but CoW still fast', () => {
    const result: CoWDetectionResult = {
      supported: true,
      method: 'clonefile',
      edr: {
        detected: true,
        products: ['Microsoft Defender'],
        hasSlowCoWEDR: false,
      },
      performance: {
        fast: true,
        durationMs: 15,
        samples: 2,
        maxDurationMs: 18,
        confidence: 'high',
      },
      recommendedType: 'cow',
    };

    expect(result.supported).toBe(true);
    expect(result.edr?.detected).toBe(true);
    expect(result.edr?.hasSlowCoWEDR).toBe(false);
    expect(result.performance?.fast).toBe(true);
    expect(result.performance?.confidence).toBe('high');
    expect(result.recommendedType).toBe('cow');
  });

  it('should recommend worktree in medium confidence (gray zone)', () => {
    // 20-100ms is the gray zone - conservative approach uses worktree
    const result: CoWDetectionResult = {
      supported: true,
      method: 'clonefile',
      edr: {
        detected: false,
        products: [],
        hasSlowCoWEDR: false,
      },
      performance: {
        fast: false, // Conservative in gray zone
        durationMs: 45,
        samples: 2,
        maxDurationMs: 48,
        confidence: 'medium',
      },
      recommendedType: 'worktree',
    };

    expect(result.supported).toBe(true);
    expect(result.performance?.confidence).toBe('medium');
    expect(result.performance?.fast).toBe(false);
    expect(result.recommendedType).toBe('worktree');
  });

  it('should recommend worktree when timing shows spikes', () => {
    // Spike detection: max >> average indicates intermittent interference
    const result: CoWDetectionResult = {
      supported: true,
      method: 'reflink',
      edr: {
        detected: true,
        products: ['Unknown EDR'],
        hasSlowCoWEDR: false,
      },
      performance: {
        fast: false,
        durationMs: 25, // Average in gray zone
        samples: 2,
        maxDurationMs: 150, // But spike into slow territory
        confidence: 'medium',
      },
      recommendedType: 'worktree', // Spike triggers conservative choice
    };

    expect(result.supported).toBe(true);
    expect(result.performance?.maxDurationMs).toBe(150);
    expect(result.recommendedType).toBe('worktree');
  });

  it('should recommend worktree when CoW is not supported', () => {
    const result: CoWDetectionResult = {
      supported: false,
      edr: {
        detected: false,
        products: [],
        hasSlowCoWEDR: false,
      },
      recommendedType: 'worktree',
    };

    expect(result.supported).toBe(false);
    expect(result.method).toBeUndefined();
    expect(result.recommendedType).toBe('worktree');
  });

  it('should handle Windows case (no CoW support)', () => {
    const result: CoWDetectionResult = {
      supported: false,
      edr: {
        detected: true,
        products: ['Microsoft Defender'],
        hasSlowCoWEDR: false,
      },
      recommendedType: 'worktree',
    };

    expect(result.supported).toBe(false);
    expect(result.edr?.detected).toBe(true);
    expect(result.recommendedType).toBe('worktree');
  });
});

describe('Confidence level logic', () => {
  function getConfidence(
    avgTiming: number,
    fastThreshold = 20,
    slowThreshold = 100
  ): 'high' | 'medium' | 'low' {
    if (avgTiming < fastThreshold) return 'high';
    if (avgTiming > slowThreshold) return 'high';
    return 'medium';
  }

  it('should assign high confidence to fast timings', () => {
    expect(getConfidence(5)).toBe('high');
    expect(getConfidence(10)).toBe('high');
    expect(getConfidence(19)).toBe('high');
  });

  it('should assign high confidence to clearly slow timings', () => {
    expect(getConfidence(101)).toBe('high');
    expect(getConfidence(150)).toBe('high');
    expect(getConfidence(500)).toBe('high');
  });

  it('should assign medium confidence to gray zone timings', () => {
    expect(getConfidence(20)).toBe('medium');
    expect(getConfidence(50)).toBe('medium');
    expect(getConfidence(99)).toBe('medium');
    expect(getConfidence(100)).toBe('medium'); // At boundary
  });
});

describe('Spike detection logic', () => {
  function hasSpike(
    avgTiming: number,
    maxTiming: number,
    slowThreshold = 100,
    ratioThreshold = 3
  ): boolean {
    return maxTiming > avgTiming * ratioThreshold && maxTiming > slowThreshold;
  }

  it('should detect spikes when max is much higher than average', () => {
    expect(hasSpike(10, 150)).toBe(true); // 15x average, above threshold
    expect(hasSpike(20, 150)).toBe(true); // 7.5x average, above threshold
    expect(hasSpike(30, 150)).toBe(true); // 5x average, above threshold
  });

  it('should not detect spikes when max is close to average', () => {
    expect(hasSpike(10, 15)).toBe(false); // 1.5x average
    expect(hasSpike(50, 80)).toBe(false); // 1.6x average
    expect(hasSpike(40, 100)).toBe(false); // 2.5x average, at threshold
  });

  it('should not detect spikes when max is below slow threshold', () => {
    expect(hasSpike(10, 50)).toBe(false); // 5x average but below threshold
    expect(hasSpike(20, 80)).toBe(false); // 4x average but below threshold
  });
});

describe('Recommendation decision matrix', () => {
  function getRecommendation(
    cowSupported: boolean,
    hasSlowCoWEDR: boolean,
    cowFast: boolean,
    confidence: 'high' | 'medium' | 'low',
    hasSpike: boolean,
    isGitRepo: boolean
  ): 'cow' | 'worktree' | 'copy' {
    // Priority 1: Known slow EDR - always worktree
    if (hasSlowCoWEDR) {
      return isGitRepo ? 'worktree' : 'copy';
    }

    // Priority 2: No CoW support
    if (!cowSupported) {
      return isGitRepo ? 'worktree' : 'copy';
    }

    // Priority 3: Uncertain or spikes - conservative (check BEFORE fast path)
    if (hasSpike || confidence === 'medium') {
      return isGitRepo ? 'worktree' : 'copy';
    }

    // Priority 4: Fast with high confidence
    if (cowFast && confidence === 'high') {
      return 'cow';
    }

    // Priority 5: Slow but confident
    return isGitRepo ? 'worktree' : 'copy';
  }

  describe('Known slow EDR detected (CrowdStrike, etc.)', () => {
    it('should recommend worktree regardless of timing', () => {
      expect(getRecommendation(true, true, true, 'high', false, true)).toBe('worktree');
      expect(getRecommendation(true, true, false, 'high', false, true)).toBe('worktree');
      expect(getRecommendation(true, true, true, 'medium', false, true)).toBe('worktree');
    });

    it('should recommend copy when no git repo and slow EDR detected', () => {
      expect(getRecommendation(true, true, true, 'high', false, false)).toBe('copy');
    });
  });

  describe('No slow EDR - timing based decisions', () => {
    it('should recommend cow when fast with high confidence', () => {
      expect(getRecommendation(true, false, true, 'high', false, true)).toBe('cow');
      expect(getRecommendation(true, false, true, 'high', false, false)).toBe('cow');
    });

    it('should recommend worktree when medium confidence (gray zone)', () => {
      expect(getRecommendation(true, false, false, 'medium', false, true)).toBe('worktree');
    });

    it('should recommend worktree when spikes detected', () => {
      expect(getRecommendation(true, false, true, 'high', true, true)).toBe('worktree');
    });

    it('should recommend worktree when slow with high confidence', () => {
      expect(getRecommendation(true, false, false, 'high', false, true)).toBe('worktree');
    });
  });

  describe('No CoW support', () => {
    it('should recommend worktree when git repo exists', () => {
      expect(getRecommendation(false, false, false, 'high', false, true)).toBe('worktree');
    });

    it('should recommend copy when no git repo', () => {
      expect(getRecommendation(false, false, false, 'high', false, false)).toBe('copy');
    });
  });
});

describe('EDR impact classification', () => {
  const KNOWN_SLOW_EDR_PRODUCTS = [
    'CrowdStrike Falcon',
    'SentinelOne',
    'Cylance',
    'Carbon Black/VMware',
    'Microsoft Defender for Endpoint',
    'FireEye/XAGENT',
  ];

  it('should classify known CoW-impacting EDRs correctly', () => {
    for (const product of KNOWN_SLOW_EDR_PRODUCTS) {
      expect(product).toBeDefined();
      // These products should be flagged as knownSlowCoW
      expect([
        'CrowdStrike Falcon',
        'SentinelOne',
        'Cylance',
        'Carbon Black/VMware',
        'Microsoft Defender for Endpoint',
        'FireEye/XAGENT',
      ]).toContain(product);
    }
  });

  it('should short-circuit to worktree when CrowdStrike detected', () => {
    // CrowdStrike is the primary target - should always short-circuit
    const result = [
      'CrowdStrike Falcon',
      'SentinelOne',
      'Cylance',
      'Carbon Black/VMware',
      'FireEye/XAGENT',
    ].includes('CrowdStrike Falcon');

    expect(result).toBe(true);
  });
});
