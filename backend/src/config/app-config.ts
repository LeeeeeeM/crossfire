function numEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const APP_CONFIG = {
  port: numEnv("PORT", 8787),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  databaseUrl: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/sync_demo"
};

export const GAME_CONFIG = {
  tickMs: numEnv("TICK_MS", 50),
  maxPlayers: numEnv("MAX_PLAYERS", 5),
  inputTimeoutMs: numEnv("INPUT_TIMEOUT_MS", 150),
  reconnectGraceMs: numEnv("RECONNECT_GRACE_MS", 10_000),
  worldWidth: numEnv("WORLD_WIDTH", 2000),
  worldHeight: numEnv("WORLD_HEIGHT", 1200),
  playerRadius: numEnv("PLAYER_RADIUS", 14),
  movePerFrame: numEnv("MOVE_PER_FRAME", 5),
  bulletSpeed: numEnv("BULLET_SPEED", 17),
  bulletTtl: numEnv("BULLET_TTL", 80),
  damage: numEnv("DAMAGE", 30),
  knifeMeleeDamage: numEnv("KNIFE_MELEE_DAMAGE", 28),
  maxHp: numEnv("MAX_HP", 90),
  respawnFrames: numEnv("RESPAWN_FRAMES", 60),
  weaponSlotSize: numEnv("WEAPON_SLOT_SIZE", 3),
  itemSlotSize: numEnv("ITEM_SLOT_SIZE", 5),
  inventorySize: numEnv("INVENTORY_SIZE", 8),
  pickupRadius: numEnv("PICKUP_RADIUS", 44),
  maxDrops: numEnv("MAX_DROPS", 18),
  dropIntervalFrames: numEnv("DROP_INTERVAL_FRAMES", 260),
  dropJitterFrames: numEnv("DROP_JITTER_FRAMES", 60),
  dropBatchBase: numEnv("DROP_BATCH_BASE", 2),
  dropBatchCycle: numEnv("DROP_BATCH_CYCLE", 3),
  dropSpawnAttempts: numEnv("DROP_SPAWN_ATTEMPTS", 30),
  dropRandomSaltMod: numEnv("DROP_RANDOM_SALT_MOD", 997),
  magSmg9mm: numEnv("MAG_SMG_9MM", 30),
  magAr762: numEnv("MAG_AR_762", 30),
  magAk762: numEnv("MAG_AK_762", 30),
  magSniper762: numEnv("MAG_SNIPER_762", 5),
  magM9: numEnv("MAG_M9_9MM", 15),
  smgFireCooldownFrames: numEnv("SMG_FIRE_COOLDOWN_FRAMES", 6),
  arFireCooldownFrames: numEnv("AR_FIRE_COOLDOWN_FRAMES", 8),
  reloadDurationFrames: numEnv("RELOAD_DURATION_FRAMES", 45),
  bulletSpawnOffset: numEnv("BULLET_SPAWN_OFFSET", 20),
  dropThrowOffset: numEnv("DROP_THROW_OFFSET", 30),
  bulletHitRadiusPadding: numEnv("BULLET_HIT_RADIUS_PADDING", 2),
  explosionFxFrames: numEnv("EXPLOSION_FX_FRAMES", 15),
  defaultGunCooldownFrames: numEnv("DEFAULT_GUN_COOLDOWN_FRAMES", 6),
  knifeArcHalfRad: Math.PI / 3,
  knifeMeleeRange: numEnv("KNIFE_MELEE_RANGE", 52),
  knifeCooldownFrames: numEnv("KNIFE_COOLDOWN_FRAMES", 12),
  knifeArcFxFrames: numEnv("KNIFE_ARC_FX_FRAMES", 11)
};
