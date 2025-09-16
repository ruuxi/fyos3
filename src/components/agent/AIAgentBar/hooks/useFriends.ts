import { useEffect, useMemo, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api as convexApi } from '../../../../../convex/_generated/api';
import type { Doc } from '../../../../../convex/_generated/dataModel';

export type FriendProfile = { ownerId: string; nickname?: string; email?: string };

type DmMessage = Doc<'dm_messages'>;

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

  async function sendDm(content: string) {
    if (!isAuthenticated || !activePeerId) return;
    const text = (content || '').trim();
    if (!text) return;
    await sendDmMutation({ peerId: activePeerId, content: text });
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
  } as const;
}

