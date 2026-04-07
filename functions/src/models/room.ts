import {GamePlayer} from "./game_player";
import type {Message} from "./message";
import type {RoomUser} from "./room_user";
import type {RoomType} from "./room_type";
import type {Team} from "./team";

/** Matches Dart room model (Firestore-serializable). */
export interface Room {
  id: string;
  code: string;
  messages: Message[];
  type: RoomType;
  turnsPerPlayerHistory: Team[];
  playersToGuess: GamePlayer[];
  users?: RoomUser[];
}
