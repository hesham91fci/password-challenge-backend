import {GamePlayer} from "./game_player";
import type {PausedRoomUser} from "./paused_room_user";
import type {RoomType} from "./room_type";
import type {Team} from "./team";

/**
 * Matches Dart `Room` model (Firestore-serializable).
 * Users and messages are subcollections, not fields here.
 */
export interface Room {
  id: string;
  code: string;
  type: RoomType;
  turnsPerRound: Team[];
  playersToGuess: GamePlayer[];
  usersCount: number;
  score: string;
  currentPlayerIdToGuess?: number | null;
  guessedPlayerIDs: string[];
  isRoundTransitioning: boolean;
  remainingAlternativeVotes: number;
  remainingSeconds?: number | null;
  pausedActiveTurn?: PausedRoomUser | null;
  pausedPresentUserIds?: string[] | null;
  turnDurationInSeconds: number;
  isRecordingAllowed: boolean;
}
