/**
 * Copy-on-Write detection and performance testing
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import type { CoWDetectionResult, EDRDetectionResult } from '../types/index';
import { detectEDR, detectCrowdStrike, hasSlowCoWEDR } from '../edr/index';

const execAsync = promisify(exec);

/**
 * Detect Copy-on-Write support on the current platform
 * Tests actual CoW functionality by creating test files
 * Includes EDR detection and multi-iteration performance testing
 *
 * Strategy:
 * 1. Known slow EDR detected (CrowdStrike, SentinelOne, etc.) → worktree
 * 2. No slow EDR detected + fast CoW timing → cow
 * 3. Uncertain cases → worktree (conservative)
 */
export async function detectCoWSupport(testDir: string): Promise<CoWDetectionResult> {
  // Ensure test directory exists
  await fs.mkdir(testDir, { recursive: true });

  const testFile = path.join(testDir, `.cow-test-${Date.now()}`);
  const clonedFile = path.join(testDir, `.cow-clone-${Date.now()}`);

  // Detect EDR software that may impact CoW performance
  let edrResult: CoWDetectionResult['edr'] = {
    detected: false,
    products: [],
    hasSlowCoWEDR: false,
  };
  let hasCrowdStrike = false;

  try {
    const [edrDetection, crowdstrikeDetection] = await Promise.all([
      detectEDR(),
      detectCrowdStrike(),
    ]);

    hasCrowdStrike = crowdstrikeDetection;
    edrResult = {
      detected: edrDetection.detected,
      products: edrDetection.details.map((d) => d.product),
      hasSlowCoWEDR: hasSlowCoWEDR(edrDetection) || hasCrowdStrike,
    };
  } catch {
    // EDR detection failed, continue without EDR info
  }

  // If we detected a known slow CoW EDR, we can short-circuit to worktree
  // without needing timing validation (high confidence)
  if (edrResult.hasSlowCoWEDR) {
    return {
      supported: true, // CoW technically works, just slow
      edr: edrResult,
      recommendedType: 'worktree',
    };
  }

  try {
    const platform = os.platform();

    // Skip CoW detection entirely on Windows (no native CoW support)
    if (platform === 'win32') {
      return {
        supported: false,
        edr: edrResult,
        recommendedType: 'worktree',
      };
    }

    // Create test files of varying sizes
    // Larger files more likely to trigger EDR scanning
    const testSizes = [1 * 1024 * 1024, 5 * 1024 * 1024]; // 1MB and 5MB
    let cowSupported = false;
    let cowMethod: 'clonefile' | 'reflink' | undefined;
    const timings: number[] = [];

    for (const size of testSizes) {
      const dataFile = `${testFile}-${size}`;
      const cloneTarget = `${clonedFile}-${size}`;

      try {
        const testData = Buffer.alloc(size, 'x');
        await fs.writeFile(dataFile, testData);

        if (platform === 'darwin') {
          // macOS: Try cp -c (clonefile)
          const startTime = performance.now();
          await execAsync(`cp -c "${dataFile}" "${cloneTarget}"`);
          const duration = performance.now() - startTime;
          timings.push(duration);

          const [origStat, cloneStat] = await Promise.all([
            fs.stat(dataFile),
            fs.stat(cloneTarget),
          ]);

          if (origStat.size === cloneStat.size) {
            cowSupported = true;
            cowMethod = 'clonefile';
          }
        } else if (platform === 'linux') {
          // Linux: Try cp --reflink=auto
          const startTime = performance.now();
          await execAsync(`cp -a --reflink=auto "${dataFile}" "${cloneTarget}"`);
          const duration = performance.now() - startTime;
          timings.push(duration);

          const [origStat, cloneStat] = await Promise.all([
            fs.stat(dataFile),
            fs.stat(cloneTarget),
          ]);

          if (origStat.ino === cloneStat.ino) {
            cowSupported = true;
            cowMethod = 'reflink';
          } else {
            // Check filesystem type
            try {
              const { stdout } = await execAsync(`findmnt -T "${testDir}" -o FSTYPE --noheadings`);
              const fsType = stdout.trim();
              if (fsType === 'btrfs' || fsType.includes('xfs')) {
                cowSupported = true;
                cowMethod = 'reflink';
              }
            } catch {
              // findmnt failed
            }
          }
        }

        // Cleanup this iteration's files
        await fs.unlink(dataFile).catch(() => {});
        await fs.unlink(cloneTarget).catch(() => {});
      } catch {
        // This size test failed, continue to next
      }
    }

    // Analyze timing results
    const avgTiming = timings.length > 0 ? timings.reduce((a, b) => a + b, 0) / timings.length : 0;
    const maxTiming = timings.length > 0 ? Math.max(...timings) : 0;

    // Conservative thresholds:
    // - < 20ms: Definitely fast (no EDR interference)
    // - 20-100ms: Uncertain (might be EDR, might be system load)
    // - > 100ms: Definitely slow (likely EDR or very slow system)
    const fastThreshold = 20;
    const slowThreshold = 100;

    let cowFast: boolean;
    let confidence: 'high' | 'medium' | 'low';

    if (avgTiming < fastThreshold) {
      cowFast = true;
      confidence = 'high';
    } else if (avgTiming > slowThreshold) {
      cowFast = false;
      confidence = 'high';
    } else {
      // Gray zone - medium confidence
      cowFast = false;
      confidence = 'medium';
    }

    // Additional heuristics for gray zone:
    // If max timing is significantly higher than average, might be intermittent EDR
    const hasSpike = maxTiming > avgTiming * 3 && maxTiming > slowThreshold;

    // Decision logic - priority order matters!
    let recommendedType: 'cow' | 'worktree' | 'copy';

    if (!cowSupported) {
      recommendedType = 'worktree';
    } else if (hasSpike || confidence === 'medium') {
      // Uncertain or saw spikes - be conservative with worktree
      // This check MUST come before the fast+high check to catch spikes
      recommendedType = 'worktree';
    } else if (cowFast && confidence === 'high') {
      // Fast and confident - use CoW
      recommendedType = 'cow';
    } else {
      // Slow but confident - definitely worktree
      recommendedType = 'worktree';
    }

    return {
      supported: cowSupported,
      method: cowMethod,
      edr: edrResult,
      performance: {
        fast: cowFast,
        durationMs: avgTiming,
        samples: timings.length,
        maxDurationMs: maxTiming,
        confidence,
      },
      recommendedType,
    };
  } catch {
    // CoW detection failed entirely
    return {
      supported: false,
      edr: edrResult,
      recommendedType: 'worktree',
    };
  }
}
