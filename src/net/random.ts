import type { Rng } from "../game/rng.ts";

/** Uniform [0, 1) from the browser's cryptographic random source. */
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};
