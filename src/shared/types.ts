/* ─── Core Types ─── */

export type PeerId = string;
export type RoomId = string;
export type TaskId = string;

export type PeerStatus = "idle" | "busy" | "waiting" | "reviewing";

export interface Peer {
  id: PeerId;
  pid: number;
  cwd: string;
  git_root: string | null;
  tty: string | null;
  name: string;
  summary: string;
  status: PeerStatus;
  room_id: RoomId | null;
  registered_at: string;
  last_seen: string;
}

export interface Room {
  id: RoomId;
  name: string;
  created_by: PeerId;
  created_at: string;
}

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export interface Task {
  id: TaskId;
  room_id: RoomId;
  title: string;
  description: string;
  assigned_to: PeerId | null;
  created_by: PeerId;
  status: TaskStatus;
  result: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  from_id: PeerId;
  to_id: PeerId | null; // null = broadcast to room
  room_id: RoomId | null;
  text: string;
  sent_at: string;
  delivered: boolean;
}

export interface ScratchpadEntry {
  id: number;
  room_id: RoomId;
  key: string;
  value: string;
  updated_by: PeerId;
  updated_at: string;
}

/* ─── Broker API Types ─── */

export interface RegisterRequest {
  pid: number;
  cwd: string;
  git_root: string | null;
  tty: string | null;
  name?: string;
}
export interface RegisterResponse { id: PeerId }

export interface HeartbeatRequest { id: PeerId; status?: PeerStatus }

export interface ListPeersRequest {
  scope: "machine" | "directory" | "repo" | "room";
  exclude_id?: PeerId;
  room_id?: RoomId;
}
export interface ListPeersResponse { peers: Peer[] }

export interface SendMessageRequest {
  from_id: PeerId;
  to_id?: PeerId;
  room_id?: RoomId;
  text: string;
}

export interface BroadcastRequest {
  from_id: PeerId;
  room_id: RoomId;
  text: string;
}

export interface PollMessagesRequest { id: PeerId }
export interface PollMessagesResponse {
  messages: Array<Message & { from_name: string; from_cwd: string }>;
}

export interface CreateRoomRequest { name: string; created_by: PeerId }
export interface CreateRoomResponse { room: Room }

export interface JoinRoomRequest { peer_id: PeerId; room_id: RoomId }
export interface LeaveRoomRequest { peer_id: PeerId }

export interface CreateTaskRequest {
  room_id: RoomId;
  title: string;
  description: string;
  created_by: PeerId;
  assigned_to?: PeerId;
}
export interface UpdateTaskRequest {
  task_id: TaskId;
  status?: TaskStatus;
  result?: string;
  assigned_to?: PeerId;
}
export interface ListTasksRequest { room_id: RoomId }

export interface ScratchpadGetRequest { room_id: RoomId; key: string }
export interface ScratchpadSetRequest {
  room_id: RoomId;
  key: string;
  value: string;
  updated_by: PeerId;
}
export interface ScratchpadListRequest { room_id: RoomId }

export interface MessageHistoryRequest {
  room_id?: RoomId;
  peer_id?: PeerId;
  limit?: number;
  search?: string;
}
