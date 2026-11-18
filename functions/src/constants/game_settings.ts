/** Mirrors Flutter `GameSettings` values used when creating a room. */
export const ALTERNATIVE_VOTE_THRESHOLD = 3;
export const DEFAULT_TURN_DURATION_SECONDS = 40;
export const ALLOWED_TURN_DURATIONS = [20, 30, 40] as const;

/** Seconds after RTDB offline before the user is removed from their room. */
export const OFFLINE_THRESHOLD_SECONDS = 20;

export const RTDB_URL =
  "https://password-challenge-55651-default-rtdb.europe-west1.firebasedatabase.app";
export const RTDB_INSTANCE = "password-challenge-55651-default-rtdb";
