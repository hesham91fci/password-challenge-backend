import {readFileSync} from "node:fs";
import {join} from "node:path";
import {onRequest} from "firebase-functions/https";
import type {GamePlayer} from "./models/game_player";

const cluesPath = join(__dirname, "..", "data", "clues.json");
const playersPath = join(__dirname, "..", "data", "players.json");

const clues: string[] = (() => {
  const raw = readFileSync(cluesPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    throw new Error("clues.json must be a string array");
  }
  return parsed;
})();

const players: GamePlayer[] = (() => {
  const raw = readFileSync(playersPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("players.json must be an array");
  }
  return parsed.map((row, i) => {
    if (typeof row !== "object" || row === null) {
      throw new Error(`players.json: invalid row at index ${i}`);
    }
    const o = row as Record<string, unknown>;
    const id = o.id;
    if (typeof id !== "number" && typeof id !== "string") {
      throw new Error(`players.json: invalid id at index ${i}`);
    }
    return {
      id: String(id),
      dob: typeof o.dob === "string" || o.dob === null ? o.dob : null,
      name: typeof o.name === "string" || o.name === null ? o.name : null,
      nationality:
        typeof o.nationality === "string" || o.nationality === null ?
          o.nationality :
          null,
      normalizedName:
        typeof o.normalizedName === "string" || o.normalizedName === null ?
          o.normalizedName :
          null,
      photo: typeof o.photo === "string" || o.photo === null ? o.photo : null,
      popularity:
        typeof o.popularity === "string" || o.popularity === null ?
          o.popularity :
          null,
    };
  });
})();

/**
 * Randomly samples distinct items without replacement.
 * @template T
 * @param {T[]} items Source items (not mutated).
 * @param {number} count Number to draw; capped by items.length.
 * @return {T[]} The sampled items.
 */
function sampleWithoutReplacement<T>(items: T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = Math.floor(Math.random() * pool.length);
    out.push(...pool.splice(j, 1));
  }
  return out;
}

/**
 * HTTP endpoint that returns one random clue from `data/clues.json`.
 */
export const generateClue = onRequest({cors: true}, (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({error: "Method not allowed"});
    return;
  }
  const idx = Math.floor(Math.random() * clues.length);
  res.json({clue: clues[idx]});
});

const DECOY_COUNT = 9;
const POOL_SIZE = 1 + DECOY_COUNT;

/**
 * HTTP endpoint: builds a pool of 10 players (the correct `correctPlayerId`
 * plus 9 random others), then returns one player drawn uniformly from that
 * pool. Query: `correctPlayerId` (integer).
 */
export const guessPlayer = onRequest({cors: true}, (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({error: "Method not allowed"});
    return;
  }
  const rawId = req.query.correctPlayerId;
  const idStr = Array.isArray(rawId) ? rawId[0] : rawId;
  const correctPlayerId =
    typeof idStr === "string" ? Number.parseInt(idStr, 10) : Number.NaN;
  if (!Number.isInteger(correctPlayerId)) {
    res.status(400).json({error: "correctPlayerId must be an integer"});
    return;
  }
  const correctIdKey = String(correctPlayerId);
  const correct = players.find((p) => p.id === correctIdKey);
  if (!correct) {
    res.status(404).json({error: "Player not found"});
    return;
  }
  const others = players.filter((p) => p.id !== correctIdKey);
  if (others.length < DECOY_COUNT) {
    res.status(400).json({
      error: `Need at least ${POOL_SIZE} distinct players in data`,
    });
    return;
  }
  const decoys = sampleWithoutReplacement(others, DECOY_COUNT);
  const pool = [correct, ...decoys];
  const pickIdx = Math.floor(Math.random() * pool.length);
  const pick = pool[pickIdx];
  if (pick === undefined) {
    res.status(500).json({error: "Internal error"});
    return;
  }
  res.json(pick);
});
