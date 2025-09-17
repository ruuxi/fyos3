import { useEffect, useMemo, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api as convexApi } from '../../../../../convex/_generated/api';
import type { Doc } from '../../../../../convex/_generated/dataModel';

export type FriendProfile = { ownerId: string; nickname?: string; email?: string };

type DmMessage = Doc<'dm_messages'>;

export type DmThread = {
  peerId: string;
  peerNickname?: string;
  peerEmail?: string;
  lastMessageAt: number;
  lastMessageContent?: string;
  lastMessageSenderId?: string;
};

type UseFriendsState = {
  isAuthenticated: boolean;
  me: FriendProfile | null | undefined;
  setNickname: (nickname: string) => Promise<void>;
  friends: FriendProfile[];
  friendsLoading: boolean;
  friendsError: string | null;
  addFriend: (nickname: string) => Promise<void>;
  activePeerId: string | null;
  setActivePeerId: (id: string | null) => void;
  dmMessages: DmMessage[] | undefined;
  sendDm: (content: string) => Promise<void>;
  sendDmToPeer: (peerId: string, content: string) => Promise<void>;
  dmThreads: DmThread[];
};

export function useFriends(): UseFriendsState {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const [activePeerId, setActivePeerId] = useState<string | null>(null);

  const myProfile = useQuery(
    convexApi.friends.getMyProfile,
    isAuthenticated ? {} : 'skip',
  );
  const friendsList = useQuery(
    convexApi.friends.listFriends,
    isAuthenticated ? {} : 'skip',
  );
  const dmThreadsData = useQuery(
    convexApi.friends.listDmThreads,
    isAuthenticated ? {} : 'skip',
  );
  const dmMessages = useQuery(
    convexApi.friends.listDmMessages,
    isAuthenticated && activePeerId ? { peerId: activePeerId } : 'skip',
  );

  const upsertMyProfile = useMutation(convexApi.friends.upsertMyProfile);
  const addFriendMutation = useMutation(convexApi.friends.addFriend);
  const sendDmMutation = useMutation(convexApi.friends.sendDm);

  const me = useMemo(() => {
    if (!isAuthenticated) return null;
    if (authLoading) return undefined; // loading sentinel
    if (!myProfile) return null;
    return {
      ownerId: myProfile.ownerId,
      nickname: myProfile.nickname ?? undefined,
      email: myProfile.email ?? undefined,
    } as const;
  }, [isAuthenticated, authLoading, myProfile]);

  const dmThreads = useMemo(() => {
    if (!isAuthenticated) return [];
    const base = dmThreadsData ?? [];
    const seen = new Set(base.map((thread) => thread.peerId));
    const extras: DmThread[] = [];
    for (const friend of friendsList ?? []) {
      if (!seen.has(friend.ownerId)) {
        extras.push({
          peerId: friend.ownerId,
          peerNickname: friend.nickname,
          peerEmail: friend.email,
          lastMessageAt: 0,
        });
      }
    }
    const combined = [...base, ...extras];
    combined.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
    return combined;
  }, [isAuthenticated, dmThreadsData, friendsList]);

  useEffect(() => {
    // Default active to agent (null). If a peer was previously selected, leave it.
  }, []);

  async function setNickname(nickname: string) {
    if (!isAuthenticated) return;
    await upsertMyProfile({ nickname });
  }

  async function addFriend(nickname: string) {
    if (!isAuthenticated) return;
    const v = (nickname || '').trim();
    if (!v) return;
    await addFriendMutation({ nickname: v });
  }

  async function sendDmToPeer(peerId: string, content: string) {
    if (!isAuthenticated) return;
    const text = (content || '').trim();
    if (!text) return;
    await sendDmMutation({ peerId, content: text });
  }

  async function sendDm(content: string) {
    if (!isAuthenticated || !activePeerId) return;
    await sendDmToPeer(activePeerId, content);
  }

  return {
    isAuthenticated,
    me,
    setNickname,
    friends: friendsList ?? [],
    friendsLoading: Boolean(isAuthenticated && friendsList === undefined),
    friendsError: null,
    addFriend,
    activePeerId,
    setActivePeerId,
    dmMessages,
    sendDm,
    sendDmToPeer,
    dmThreads,
  } as const;
}
