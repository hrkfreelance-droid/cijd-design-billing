export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
export const PASSWORD_POLICY_TEXT =
  "At least 12 characters, with an upper-case letter, a lower-case letter and a number.";

export function passwordPolicyProblem(value: string): string | null {
  if (typeof value !== "string") return PASSWORD_POLICY_TEXT;
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) return PASSWORD_POLICY_TEXT;
  if (!/[A-Z]/.test(value)) return PASSWORD_POLICY_TEXT;
  if (!/[a-z]/.test(value)) return PASSWORD_POLICY_TEXT;
  if (!/[0-9]/.test(value)) return PASSWORD_POLICY_TEXT;
  return null;
}

export function isAcceptablePassword(value: string): boolean {
  return passwordPolicyProblem(value) === null;
}

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*+-";
const ALPHABET = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

function randomBytes(length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  globalThis.crypto.getRandomValues(buffer);
  return buffer;
}

function pick(alphabet: string): string {
  return alphabet[randomBytes(1)[0] % alphabet.length];
}

export function generateTemporaryPassword(length = 16): string {
  const size = Math.max(MIN_PASSWORD_LENGTH, Math.min(MAX_PASSWORD_LENGTH, length));
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(DIGITS)];
  const rest = Array.from(randomBytes(size - required.length), (byte) => ALPHABET[byte % ALPHABET.length]);
  const characters = [...required, ...rest];
  const shuffle = randomBytes(characters.length);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = shuffle[index] % (index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  const candidate = characters.join("");
  return isAcceptablePassword(candidate) ? candidate : generateTemporaryPassword(length);
}
