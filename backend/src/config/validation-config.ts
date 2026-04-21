function numEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function strEnv(name: string, fallback: string) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

export const VALIDATION_CONFIG = {
  sessionTtlDays: numEnv("SESSION_TTL_DAYS", 30),
  usernameMinLen: numEnv("USERNAME_MIN_LEN", 3),
  usernameMaxLen: numEnv("USERNAME_MAX_LEN", 24),
  passwordMinLen: numEnv("PASSWORD_MIN_LEN", 6),
  passwordMaxLen: numEnv("PASSWORD_MAX_LEN", 128),
  playerKeyMinLen: numEnv("PLAYER_KEY_MIN_LEN", 2),
  playerKeyMaxLen: numEnv("PLAYER_KEY_MAX_LEN", 64),
  playerNameMinLen: numEnv("PLAYER_NAME_MIN_LEN", 1),
  playerNameMaxLen: numEnv("PLAYER_NAME_MAX_LEN", 24),
  playerNameFallbackPrefix: strEnv("PLAYER_NAME_FALLBACK_PREFIX", "P"),
  playerNameFallbackSliceLen: numEnv("PLAYER_NAME_FALLBACK_SLICE_LEN", 8)
};

const usernameRegex = new RegExp(
  `^[a-zA-Z0-9_]{${VALIDATION_CONFIG.usernameMinLen},${VALIDATION_CONFIG.usernameMaxLen}}$`
);
const playerKeyRegex = new RegExp(
  `^[a-zA-Z0-9_-]{${VALIDATION_CONFIG.playerKeyMinLen},${VALIDATION_CONFIG.playerKeyMaxLen}}$`
);
const playerNameRegex = new RegExp(
  `^[a-zA-Z0-9_]{${VALIDATION_CONFIG.playerNameMinLen},${VALIDATION_CONFIG.playerNameMaxLen}}$`
);

export function isValidUsername(username: string) {
  return usernameRegex.test(username);
}

export function isValidPassword(password: string) {
  return password.length >= VALIDATION_CONFIG.passwordMinLen && password.length <= VALIDATION_CONFIG.passwordMaxLen;
}

export function isValidPlayerKey(playerKey: string) {
  return playerKeyRegex.test(playerKey);
}

export function isValidPlayerName(playerName: string) {
  return playerNameRegex.test(playerName);
}

export function fallbackPlayerName(playerKey: string) {
  return `${VALIDATION_CONFIG.playerNameFallbackPrefix}${playerKey.slice(0, VALIDATION_CONFIG.playerNameFallbackSliceLen)}`;
}
