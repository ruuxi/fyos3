import { useMemo, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api as convexApi } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';

export type GroupChatSummary = {
  id: string;
  name: string;
  ownerId: string;
  capacity: number;
  memberCount: number;
  createdAt: number;
  updatedAt: number;
};

export type GroupMember = {
  memberId: string;
  nickname?: string;
  email?: string;
  role?: string;
  joinedAt: number;
};

export type GroupMessage = {
  _id?: string;
  id?: string;
  chatId: string;
  senderId: string;
  content: string;
  createdAt: number;
  senderNickname?: string;
  senderEmail?: string;
};

type AutoRoomPayload = {
  chat: {
    _id: Id<'group_chats'>;
    ownerId: string;
    name: string;
    isAuto: boolean;
    capacity: number;
    createdAt: number;
    updatedAt: number;
  };
  members: GroupMember[];
  messages: Array<GroupMessage & { _id: string }>;
};

type UseGroupChatsState = {
  isAuthenticated: boolean;
  groups: GroupChatSummary[];
  groupsLoading: boolean;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  groupMembers: GroupMember[];
  groupMessages: GroupMessage[];
  createGroup: (args: { name: string; memberIds: string[] }) => Promise<void>;
  addGroupMembers: (args: { chatId: string; memberIds: string[] }) => Promise<void>;
  leaveGroup: (chatId: string) => Promise<void>;
  sendGroupMessage: (chatId: string, content: string) => Promise<void>;
  autoRoom: AutoRoomPayload | null | undefined;
  claimAutoRoom: (opts: { nickname?: string }) => Promise<void>;
  leaveAutoRoom: () => Promise<void>;
  sendAutoMessage: (content: string) => Promise<void>;
};

export function useGroupChats(): UseGroupChatsState {
  const { isAuthenticated } = useConvexAuth();
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const groupsData = useQuery(
    convexApi.groupChats.listGroupChats,
    isAuthenticated ? {} : 'skip',
  );

  const groupIdMap = useMemo(() => {
    const map = new Map<string, Id<'group_chats'>>();
    if (!groupsData) return map;
    for (const entry of groupsData) {
      map.set(String(entry.chatId), entry.chatId);
    }
    return map;
  }, [groupsData]);

  const normalizedGroups: GroupChatSummary[] = useMemo(() => {
    if (!groupsData) return [];
    return groupsData.map((entry) => ({
      id: String(entry.chatId),
      name: entry.name,
      ownerId: entry.ownerId,
      capacity: entry.capacity,
      memberCount: entry.memberCount,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  }, [groupsData]);

  const activeConvexId = activeGroupId ? groupIdMap.get(activeGroupId) : undefined;

  const membersData = useQuery(
    convexApi.groupChats.listGroupMembers,
    isAuthenticated && activeConvexId ? { chatId: activeConvexId } : 'skip',
  );

  const messagesData = useQuery(
    convexApi.groupChats.listGroupMessages,
    isAuthenticated && activeConvexId ? { chatId: activeConvexId, limit: 200 } : 'skip',
  );

  const autoRoom = useQuery(
    convexApi.groupChats.getMyAutoRoom,
    isAuthenticated ? {} : 'skip',
  );

  const createGroupMutation = useMutation(convexApi.groupChats.createGroupChat);
  const addGroupMembersMutation = useMutation(convexApi.groupChats.addGroupMembers);
  const leaveGroupMutation = useMutation(convexApi.groupChats.leaveGroupChat);
  const sendGroupMessageMutation = useMutation(convexApi.groupChats.sendGroupMessage);
  const claimAutoRoomMutation = useMutation(convexApi.groupChats.claimAutoRoom);
  const leaveAutoRoomMutation = useMutation(convexApi.groupChats.leaveAutoRoom);

  const groupMembers = membersData ?? [];
  const groupMessages = (messagesData ?? []).map((m) => ({
    ...m,
    chatId: String(m.chatId),
  }));

  async function createGroup(args: { name: string; memberIds: string[] }) {
    if (!isAuthenticated) return;
    const name = args.name.trim();
    if (!name) return;
    await createGroupMutation({ name, memberIds: args.memberIds });
  }

  async function addGroupMembers(args: { chatId: string; memberIds: string[] }) {
    if (!isAuthenticated) return;
    if (!args.chatId || args.memberIds.length === 0) return;
    const convexId = groupIdMap.get(args.chatId);
    if (!convexId) return;
    await addGroupMembersMutation({ chatId: convexId, memberIds: args.memberIds });
  }

  async function leaveGroup(chatId: string) {
    if (!isAuthenticated) return;
    const convexId = groupIdMap.get(chatId);
    if (!convexId) return;
    await leaveGroupMutation({ chatId: convexId });
    if (activeGroupId === chatId) {
      setActiveGroupId(null);
    }
  }

  async function sendGroupMessage(chatId: string, content: string) {
    if (!isAuthenticated) return;
    const convexId = groupIdMap.get(chatId);
    if (!convexId) return;
    const text = content.trim();
    if (!text) return;
    await sendGroupMessageMutation({ chatId: convexId, content: text });
  }

  async function claimAutoRoom(opts: { nickname?: string }) {
    if (!isAuthenticated) return;
    await claimAutoRoomMutation({ nickname: opts.nickname });
  }

  async function leaveAutoRoom() {
    if (!isAuthenticated) return;
    await leaveAutoRoomMutation({});
  }

  async function sendAutoMessage(content: string) {
    if (!isAuthenticated || !autoRoom?.chat?._id) return;
    const text = content.trim();
    if (!text) return;
    await sendGroupMessageMutation({ chatId: autoRoom.chat._id, content: text });
  }

  return {
    isAuthenticated,
    groups: normalizedGroups,
    groupsLoading: Boolean(isAuthenticated && groupsData === undefined),
    activeGroupId,
    setActiveGroupId,
    groupMembers,
    groupMessages,
    createGroup,
    addGroupMembers,
    leaveGroup,
    sendGroupMessage,
    autoRoom,
    claimAutoRoom,
    leaveAutoRoom,
    sendAutoMessage,
  } as const;
}

