import type {MessageType} from "./message_type";

/** Matches Dart `Message`. */
export interface Message {
  id: string | null;
  text: string | null;
  userId: string | null;
  type: MessageType | null;
}
