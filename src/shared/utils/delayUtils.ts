/**
 * Shared utility functions for introducing random delays.
 * Used to mimic human behavior and avoid rate limiting.
 */

/**
 * Generates a random integer between min and max (inclusive).
 * @param min Minimum value
 * @param max Maximum value
 * @returns Random integer
 */
export const getRandomInt = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Returns a promise that resolves after a random delay between min and max milliseconds.
 * @param min Minimum delay in ms
 * @param max Maximum delay in ms
 * @returns Promise that resolves after the delay
 */
export const randomDelay = (min: number, max: number): Promise<void> => {
  const delay = getRandomInt(min, max);
  return new Promise(resolve => setTimeout(resolve, delay));
};
