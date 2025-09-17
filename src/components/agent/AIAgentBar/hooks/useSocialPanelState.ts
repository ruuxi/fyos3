import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useFriends } from './useFriends';
import { useGroupChats } from './useGroupChats';

export type SocialView =
  | { kind: 'settings' }
  | { kind: 'dm'; peerId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'auto' };

export type ChatListItem = {
  key: string;
  kind: 'dm' | 'group' | 'auto';
  label: string;
  description?: string;
  lastActivity: number;
  peerId?: string;
  groupId?: string;
};

type UseSocialPanelArgs = {
  input: string;
  clearInput: () => void;
  enterFriendsView: () => void;
};

export function useSocialPanelState({ input, clearInput, enterFriendsView }: UseSocialPanelArgs) {
  const friendsState = useFriends();
  const groupState = useGroupChats();

  const [socialView, setSocialView] = useState<SocialView>({ kind: 'settings' });
  const [showCreateGroupForm, setShowCreateGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<string[]>([]);
  const [groupFormBusy, setGroupFormBusy] = useState(false);

  const friendsList = friendsState.friends;
  const dmThreadsList = friendsState.dmThreads;
  const groupSummaries = groupState.groups;

  const friendsById = useMemo(() => {
    const map = new Map<string, (typeof friendsList)[number]>();
    friendsList.forEach((friend) => {
      map.set(friend.ownerId, friend);
    });
    return map;
  }, [friendsList]);

  const dmThreadByPeer = useMemo(() => {
    const map = new Map<string, (typeof dmThreadsList)[number]>();
    dmThreadsList.forEach((thread) => {
      map.set(thread.peerId, thread);
    });
    return map;
  }, [dmThreadsList]);

  const autoRoomMembers = groupState.autoRoom?.members ?? [];
  const autoRoomMessages = (groupState.autoRoom?.messages ?? []).map((message) => ({
    ...message,
    chatId: String(message.chatId),
  }));

  const chatItems = useMemo<ChatListItem[]>(() => {
    const items: ChatListItem[] = [];

    for (const thread of dmThreadsList) {
      const friendProfile = friendsById.get(thread.peerId);
      const label = friendProfile?.nickname
        || thread.peerNickname
        || friendProfile?.email
        || thread.peerEmail
        || thread.peerId.slice(0, 8);
      const snippet = thread.lastMessageContent ? thread.lastMessageContent.trim() : '';
      items.push({
        key: `dm-${thread.peerId}`,
        kind: 'dm',
        label,
        description: snippet ? (snippet.length > 60 ? `${snippet.slice(0, 57)}…` : snippet) : undefined,
        lastActivity: thread.lastMessageAt ?? 0,
        peerId: thread.peerId,
      });
    }

    for (const group of groupSummaries) {
      items.push({
        key: `group-${group.id}`,
        kind: 'group',
        label: group.name,
        description: `${group.memberCount} members`,
        lastActivity: group.updatedAt ?? group.createdAt ?? 0,
        groupId: group.id,
      });
    }

    if (groupState.autoRoom?.chat) {
      const autoId = String(groupState.autoRoom.chat._id);
      items.push({
        key: `auto-${autoId}`,
        kind: 'auto',
        label: groupState.autoRoom.chat.name,
        description: `${autoRoomMembers.length} people`,
        lastActivity: groupState.autoRoom.chat.updatedAt ?? groupState.autoRoom.chat.createdAt ?? 0,
      });
    }

    items.sort((a, b) => b.lastActivity - a.lastActivity);
    return items;
  }, [dmThreadsList, friendsById, groupSummaries, groupState.autoRoom, autoRoomMembers.length]);

  const activeChatKey = useMemo(() => {
    if (socialView.kind === 'dm') return `dm-${socialView.peerId}`;
    if (socialView.kind === 'group') return `group-${socialView.groupId}`;
    if (socialView.kind === 'auto' && groupState.autoRoom?.chat?._id) {
      return `auto-${String(groupState.autoRoom.chat._id)}`;
    }
    return null;
  }, [socialView, groupState.autoRoom?.chat?._id]);

  const myUserId = friendsState.me?.ownerId ?? null;
  const meDisplayName = friendsState.me?.nickname || (friendsState.me ? 'Me' : 'You');

  const activePeerProfile = socialView.kind === 'dm' ? friendsById.get(socialView.peerId) : undefined;
  const activeDmThread = socialView.kind === 'dm' ? dmThreadByPeer.get(socialView.peerId) : undefined;
  const activePeerLabel = socialView.kind === 'dm'
    ? (activePeerProfile?.nickname
      || activeDmThread?.peerNickname
      || activePeerProfile?.email
      || activeDmThread?.peerEmail
      || socialView.peerId.slice(0, 8))
    : undefined;

  const activeGroupSummary = useMemo(() => {
    if (socialView.kind !== 'group') return null;
    return groupSummaries.find((group) => group.id === socialView.groupId) ?? null;
  }, [groupSummaries, socialView]);

  const openFriendsSettings = useCallback(() => {
    enterFriendsView();
    setSocialView({ kind: 'settings' });
    friendsState.setActivePeerId(null);
    groupState.setActiveGroupId(null);
  }, [enterFriendsView, friendsState, groupState]);

  const openDmChat = useCallback((peerId: string) => {
    enterFriendsView();
    friendsState.setActivePeerId(peerId);
    groupState.setActiveGroupId(null);
    setSocialView({ kind: 'dm', peerId });
  }, [enterFriendsView, friendsState, groupState]);

  const openGroupChat = useCallback((groupId: string) => {
    enterFriendsView();
    friendsState.setActivePeerId(null);
    groupState.setActiveGroupId(groupId);
    setSocialView({ kind: 'group', groupId });
  }, [enterFriendsView, friendsState, groupState]);

  const openAutoChat = useCallback(() => {
    enterFriendsView();
    friendsState.setActivePeerId(null);
    groupState.setActiveGroupId(null);
    setSocialView({ kind: 'auto' });
  }, [enterFriendsView, friendsState, groupState]);

  const socialComposerStatus = useMemo(() => {
    if (socialView.kind === 'dm') {
      return socialView.peerId ? 'ready' : 'idle';
    }
    if (socialView.kind === 'group') {
      return socialView.groupId ? 'ready' : 'idle';
    }
    if (socialView.kind === 'auto') {
      return groupState.autoRoom?.chat ? 'ready' : 'idle';
    }
    return 'idle';
  }, [socialView, groupState.autoRoom?.chat]);

  const toggleNewGroupMember = useCallback((memberId: string) => {
    setNewGroupMemberIds((prev) => {
      if (prev.includes(memberId)) {
        return prev.filter((id) => id !== memberId);
      }
      return [...prev, memberId];
    });
  }, []);

  const resetGroupForm = useCallback(() => {
    setNewGroupName('');
    setNewGroupMemberIds([]);
  }, []);

  const handleCreateGroup = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newGroupName.trim()) return;
    setGroupFormBusy(true);
    try {
      await groupState.createGroup({ name: newGroupName, memberIds: newGroupMemberIds });
      setShowCreateGroupForm(false);
      resetGroupForm();
    } finally {
      setGroupFormBusy(false);
    }
  }, [groupState, newGroupName, newGroupMemberIds, resetGroupForm]);

  const handleSocialSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    try {
      if (socialView.kind === 'dm') {
        friendsState.setActivePeerId(socialView.peerId);
        await friendsState.sendDmToPeer(socialView.peerId, text);
        clearInput();
        return;
      }
      if (socialView.kind === 'group') {
        groupState.setActiveGroupId(socialView.groupId);
        await groupState.sendGroupMessage(socialView.groupId, text);
        clearInput();
        return;
      }
      if (socialView.kind === 'auto' && groupState.autoRoom?.chat) {
        await groupState.sendAutoMessage(text);
        clearInput();
      }
    } catch (error) {
      console.warn('[friends] Failed to send message', error);
    }
  }, [clearInput, friendsState, groupState, input, socialView]);

  const handleJoinAutoRoom = useCallback(async () => {
    const defaultName = friendsState.me?.nickname ?? '';
    const promptValue = window.prompt('Choose your name for the auto group chat', defaultName);
    if (promptValue === null) return;
    const nickname = (promptValue || defaultName || '').trim();
    await groupState.claimAutoRoom({ nickname: nickname || undefined });
    openAutoChat();
  }, [friendsState.me?.nickname, groupState, openAutoChat]);

  const handleLeaveAutoRoom = useCallback(async () => {
    await groupState.leaveAutoRoom();
    openFriendsSettings();
  }, [groupState, openFriendsSettings]);

  return {
    socialView,
    chatItems,
    activeChatKey,
    socialComposerStatus,
    openFriendsSettings,
    openDmChat,
    openGroupChat,
    openAutoChat,
    handleSocialSubmit,
    handleJoinAutoRoom,
    handleLeaveAutoRoom,
    showCreateGroupForm,
    setShowCreateGroupForm,
    newGroupName,
    setNewGroupName,
    newGroupMemberIds,
    toggleNewGroupMember,
    resetGroupForm,
    handleCreateGroup,
    groupFormBusy,
    friendsState,
    groupState,
    myUserId,
    meDisplayName,
    activePeerLabel,
    activeGroupSummary,
    autoRoomMembers,
    autoRoomMessages,
  } as const;
}
