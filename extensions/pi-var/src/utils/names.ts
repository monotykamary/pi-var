/**
 * Name generation utilities for variations
 */

/**
 * List of adjectives for variation name generation
 */
const ADJECTIVES: readonly string[] = [
  'swift',
  'bright',
  'calm',
  'fierce',
  'gentle',
  'bold',
  'quiet',
  'wild',
  'purple',
  'crimson',
  'azure',
  'golden',
  'silver',
  'amber',
  'emerald',
  'brave',
  'clever',
  'happy',
  'noble',
  'proud',
  'sunny',
  'vivid',
  'warm',
  'cool',
  'deep',
  'high',
  'light',
  'rapid',
  'smooth',
  'strong',
];

/**
 * List of nouns for variation name generation
 */
const NOUNS: readonly string[] = [
  'river',
  'mountain',
  'forest',
  'ocean',
  'meadow',
  'valley',
  'canyon',
  'thunder',
  'lightning',
  'sunrise',
  'sunset',
  'storm',
  'breeze',
  'flame',
  'octopus',
  'falcon',
  'tiger',
  'wolf',
  'eagle',
  'dolphin',
  'whale',
  'bear',
  'comet',
  'galaxy',
  'nebula',
  'planet',
  'star',
  'moon',
  'nova',
  'quasar',
  'shadow',
  'echo',
  'dream',
  'spirit',
  'phantom',
  'mirage',
  'legend',
  'myth',
];

/**
 * Generate a unique variation ID
 * Uses crypto.randomUUID() when available, falls back to timestamp + random
 * @returns Unique identifier string
 */
export function generateVariationId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: timestamp + random hex string
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Generate a random integer between min and max (inclusive)
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Random integer in range [min, max]
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a human-readable variation name
 * Format: adjective-noun (e.g., "purple-octopus", "swift-river")
 * @returns Generated variation name
 */
export function generateVariationName(): string {
  const adjective = ADJECTIVES[randomInt(0, ADJECTIVES.length - 1)];
  const noun = NOUNS[randomInt(0, NOUNS.length - 1)];
  return `${adjective}-${noun}`;
}
