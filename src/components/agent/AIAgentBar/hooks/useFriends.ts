import { useEffect, useMemo, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api as convexApi } from '../../../../../convex/_generated/api';

export type FriendProfile = { ownerId: string; nickname?: string; email?: string };

type UseFriendsState = {
  isAuthenticated: boolean;
  me: { ownerId: string; nickname?: string; email?: string } | null | undefined;
  setNickname: (nickname: string) => Promise<void>;
  friends: FriendProfile[];
  friendsLoading: boolean;
  friendsError: string | null;
  addFriend: (nickname: string) => Promise<void>;
  activePeerId: string | null;
  setActivePeerId: (id: string | null) => void;
  dmMessages: Array<{ _id?: string; id?: string; ownerId: string; peerId: string; senderId: string; content: string; createdAt: number }> | undefined;
  sendDm: (content: string) => Promise<void>;
};

export function useFriends(): UseFriendsState {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const [activePeerId, setActivePeerId] = useState<string | null>(null);

  const myProfile = useQuery(
    (convexApi as any).friends.getMyProfile,
    isAuthenticated ? ({} as any) : 'skip'
  ) as any | undefined;
  const friendsList = useQuery(
    (convexApi as any).friends.listFriends,
    isAuthenticated ? ({} as any) : 'skip'
  ) as FriendProfile[] | undefined;
  const dmMessages = useQuery(
    (convexApi as any).friends.listDmMessages,
    isAuthenticated && activePeerId ? ({ peerId: activePeerId } as any) : 'skip'
  ) as Array<{ _id: string; ownerId: string; peerId: string; senderId: string; content: string; createdAt: number }> | undefined;

  const upsertMyProfile = useMutation((convexApi as any).friends.upsertMyProfile);
  const addFriendMutation = useMutation((convexApi as any).friends.addFriend);
  const sendDmMutation = useMutation((convexApi as any).friends.sendDm);

  const me = useMemo(() => {
    if (!isAuthenticated) return null;
    if (authLoading) return undefined; // loading sentinel
    if (!myProfile) return null;
    return {
      ownerId: (myProfile as any).ownerId,
      nickname: (myProfile as any).nickname,
      email: (myProfile as any).email,
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
    await addFriendMutation({ nickname: v } as any);
  }

  async function sendDm(content: string) {
    if (!isAuthenticated || !activePeerId) return;
    const text = (content || '').trim();
    if (!text) return;
    await sendDmMutation({ peerId: activePeerId, content: text } as any);
  }

  return {
    isAuthenticated,
    me,
    setNickname,
    friends: friendsList || [],
    friendsLoading: Boolean(isAuthenticated && friendsList === undefined),
    friendsError: null,
    addFriend,
    activePeerId,
    setActivePeerId,
    dmMessages,
    sendDm,
  } as const;
}


