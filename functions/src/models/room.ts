import {GamePlayer} from "./game_player";
import type {RoomType} from "./room_type";
import type {Team} from "./team";

/**
 * Matches Dart room model (Firestore-serializable).
 * Users and messages are subcollections, not fields here.
 */
export interface Room {
  id: string;
  code: string;
  type: RoomType;
  turnsPerPlayerHistory: Team[];
  playersToGuess: GamePlayer[];
  usersCount: number;
  score: string;
}
