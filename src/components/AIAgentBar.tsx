'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, Monitor, Store, Image as ImageIcon, MessageCircle, UserPlus, Users, Undo2 } from 'lucide-react';
import { useWebContainer } from './WebContainerProvider';
import { useScreens } from './ScreensProvider';
import { formatBytes } from '@/lib/agent/agentUtils';
import { useScrollSizing } from '@/components/agent/AIAgentBar/hooks/useScrollSizing';
import { useSocialPanelState } from '@/components/agent/AIAgentBar/hooks/useSocialPanelState';
import { useDesktopUndo } from '@/components/agent/AIAgentBar/hooks/useDesktopUndo';
import { useAgentController } from '@/components/agent/AIAgentBar/hooks/useAgentController';
import { useMediaController } from '@/components/agent/AIAgentBar/hooks/useMediaController';
import AgentBarShell from '@/components/agent/AIAgentBar/ui/AgentBarShell';
import ChatTabs from '@/components/agent/AIAgentBar/ui/ChatTabs';
import MessagesPane from '@/components/agent/AIAgentBar/ui/MessagesPane';
import ChatComposer from '@/components/agent/AIAgentBar/ui/ChatComposer';
import MediaPane from '@/components/agent/AIAgentBar/ui/MediaPane';
import AddFriendForm from '@/components/agent/AIAgentBar/ui/AddFriendForm';
import FriendMessagesPane from '@/components/agent/AIAgentBar/ui/FriendMessagesPane';
import GroupMessagesPane from '@/components/agent/AIAgentBar/ui/GroupMessagesPane';
import { buildDesktopSnapshot, restoreDesktopSnapshot } from '@/utils/desktop-snapshot';
import { getMutableWindow } from '@/components/agent/AIAgentBar/utils/window';
import { Authenticated, Unauthenticated } from 'convex/react';
import { SignInButton, UserButton } from '@clerk/nextjs';
import type { Doc } from '../../convex/_generated/dataModel';

type AgentWebContainerFns = {
  mkdir: (path: string, recursive?: boolean) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string>;
  readdirRecursive: (path?: string, maxDepth?: number) => Promise<{ path: string; type: 'file' | 'dir' }[]>;
  remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  spawn: (command: string, args?: string[], opts?: { cwd?: string }) => Promise<{ exitCode: number; output: string }>;
};

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'compact' | 'chat' | 'visit' | 'media' | 'friends'>('chat');
  const [chatSurface, setChatSurface] = useState<'agent' | 'history' | 'friend'>('agent');
  
  const { goTo, activeIndex } = useScreens();
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn } = useWebContainer();
  
  // Visit desktops state
  const [desktopsListing, setDesktopsListing] = useState<Array<{ _id: string; title: string; description?: string; icon?: string }>>([]);
  const [desktopsLoading, setDesktopsLoading] = useState(false);
  const [desktopsError, setDesktopsError] = useState<string | null>(null);

  const {
    mediaItems,
    mediaType,
    setMediaType,
    mediaError,
    uploadError,
    attachments,
    setAttachments,
    loadMedia,
    busyFlags,
    projectAttachmentsToDurable,
    dragOverlay,
    ingestUrl,
    setIngestUrl,
    handleUploadFiles,
    handleIngestFromUrl,
    removeAttachment,
  } = useMediaController({ setMode });

  const { messagesContainerRef, messagesInnerRef, containerHeight, forceFollow } = useScrollSizing(mode === 'friends' ? 'chat' : mode);

  const enterFriendsView = useCallback(() => {
    setChatSurface('friend');
    setMode('friends');
  }, [setMode]);

  const clearSocialInput = useCallback(() => {
    setInput('');
  }, [setInput]);

  const {
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
  } = useSocialPanelState({
    input,
    clearInput: clearSocialInput,
    enterFriendsView,
  });

  // Keep latest instance and fs helpers in refs so tool callbacks don't capture stale closures
  const instanceRef = useRef(instance);
  const baseFnsRef = useRef<AgentWebContainerFns>({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn });
  const fnsRef = useRef<AgentWebContainerFns>({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn });
  useEffect(() => { instanceRef.current = instance; }, [instance]);
  useEffect(() => { baseFnsRef.current = { mkdir, writeFile, readFile, readdirRecursive, remove, spawn }; }, [mkdir, writeFile, readFile, readdirRecursive, remove, spawn]);

  const agent = useAgentController({
    input,
    setInput,
    attachments,
    setAttachments,
    forceFollow,
    projectAttachmentsToDurable,
    busyUpload: !!busyFlags.uploadBusy,
    loadMedia,
    instanceRef,
    fnsRef,
  });

  const {
    openThreads,
    historyThreads,
    threadsLoading,
    threadsError,
    activeThreadId,
    setActiveThreadId,
    refreshThreads,
    startBlankThread,
    closeThread,
    showThreadHistory,
    setShowThreadHistory,
    activeThreadIdImmediateRef,
  } = agent.threads;

  const {
    messages: agentMessages,
    optimisticMessages: agentOptimisticMessages,
    status: agentStatus,
    stop: stopAgent,
    agentActive,
    didAnimateWelcome,
    setDidAnimateWelcome,
    bubbleAnimatingIds,
    lastSentAttachments,
  } = agent.chat;

  const {
    undoDepth,
    markFsChanged,
    restorePreviousSnapshot,
  } = useDesktopUndo({
    instance,
    instanceRef,
    status: agent.chat.status,
    buildSnapshot: buildDesktopSnapshot,
    restoreSnapshot: restoreDesktopSnapshot,
  });

  useEffect(() => {
    const base = baseFnsRef.current;
    const tracked = {
      mkdir: base.mkdir,
      writeFile: async (path: string, content: string) => {
        markFsChanged();
        return base.writeFile(path, content);
      },
      readFile: base.readFile,
      readdirRecursive: base.readdirRecursive,
      remove: async (path: string, opts?: { recursive?: boolean }) => {
        markFsChanged();
        return base.remove(path, opts);
      },
      spawn: async (command: string, args: string[] = [], opts?: { cwd?: string }) => {
        const cmdLower = (command || '').toLowerCase();
        const firstArg = (args[0] || '').toLowerCase();
        const isPkgMgr = /^(pnpm|npm|yarn|bun)$/.test(cmdLower);
        const isInstallLike = /^(add|install|update|remove|uninstall|i)$/i.test(firstArg);
        if (isPkgMgr && isInstallLike) {
          markFsChanged();
        }
        return base.spawn(command, args, opts);
      },
    } as typeof fnsRef.current;
    fnsRef.current = tracked;
  }, [markFsChanged, mkdir, writeFile, readFile, readdirRecursive, remove, spawn]);


  const handleUndo = useCallback(async () => {
    try {
      const restored = await restorePreviousSnapshot({
        onBeforeRestore: () => {
          const globalWin = getMutableWindow();
          if (globalWin) {
            try { globalWin.__FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL = Date.now() + 1500; } catch {}
          }
        },
        onAfterRestore: () => {
          setTimeout(() => {
            const win = getMutableWindow();
            if (win) {
              try { win.__FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL = 0; } catch {}
            }
          }, 1600);
        },
      });
      if (!restored) {
        const stackMessage = 'Nothing to undo — snapshot stack too shallow or WebContainer missing.';
        console.debug?.('[UNDO] noop:', stackMessage);
      }
    } catch (error) {
      console.error('[UNDO] Restore failed', error);
    }
  }, [restorePreviousSnapshot]);

  // UI state
  const isOpen = mode !== 'compact';
  const prevOpenRef = useRef(isOpen);
  const isOpening = isOpen && !prevOpenRef.current;
  const isClosing = !isOpen && prevOpenRef.current;
  useEffect(() => { prevOpenRef.current = isOpen; }, [isOpen]);
  const barAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event?.data;
      if (!payload || typeof payload !== 'object') return;
      const type = (payload as { type?: unknown }).type;
      if (type === 'FYOS_OPEN_CHAT') {
        setMode('chat');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // One-time welcome animation flag
  useEffect(() => {
    const t = setTimeout(() => setDidAnimateWelcome(true), 500);
    return () => clearTimeout(t);
  }, [setDidAnimateWelcome]);

  // Visit desktops fetcher
  useEffect(() => {
    if (mode !== 'visit') return;
    let cancelled = false;

    const loadDesktops = async () => {
      setDesktopsLoading(true);
      setDesktopsError(null);
      try {
        const response = await fetch('/api/visit/desktops');
        const data = (await response.json()) as { desktops?: Doc<'desktops_public'>[] };
        if (cancelled) return;
        const list = (data.desktops ?? []).map((desktop) => ({
          _id: String(desktop._id),
          title: desktop.title ?? 'Untitled desktop',
          description: desktop.description,
          icon: desktop.icon,
        }));
        setDesktopsListing(list);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load desktops';
          setDesktopsError(message);
        }
      } finally {
        if (!cancelled) {
          setDesktopsLoading(false);
        }
      }
    };

    void loadDesktops();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Keyboard shortcuts: Cmd/Ctrl+K to open chat, Esc to close overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = (e.key ?? '').toLowerCase();
      const isK = key === 'k';
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setMode('chat');
      }
      if (key === 'escape' && mode !== 'compact') {
        e.preventDefault();
        setMode('compact');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Handlers
  const handleAgentSubmit = agent.composer.handleSubmit;

  // Drag overlay

  const handleSelectAgent = useCallback(() => {
    setChatSurface('agent');
    setMode('chat');
  }, [setMode]);

  const handleOpenFriendsPanel = useCallback(() => {
    setChatSurface('friend');
    setMode('friends');
    openFriendsSettings();
  }, [openFriendsSettings, setMode]);

  const handleStartGroup = useCallback(() => {
    setChatSurface('friend');
    setMode('friends');
    openFriendsSettings();
    setShowCreateGroupForm(true);
  }, [openFriendsSettings, setMode, setShowCreateGroupForm]);

  const handleSelectChatItem = useCallback((item: typeof chatItems[number]) => {
    setChatSurface('friend');
    setMode('friends');
    if (item.kind === 'dm' && item.peerId) {
      openDmChat(item.peerId);
      return;
    }
    if (item.kind === 'group' && item.groupId) {
      openGroupChat(item.groupId);
      return;
    }
    if (item.kind === 'auto') {
      openAutoChat();
    }
  }, [openAutoChat, openDmChat, openGroupChat, setMode]);

  const handleBackToHistory = useCallback(() => {
    setChatSurface('history');
    setMode('chat');
  }, [setMode]);

  const baseChatMode = chatSurface === 'friend' ? 'friends' : 'chat';

  const navItems = [
    {
      key: 'store',
      label: 'App Store',
      active: activeIndex === 0,
      onClick: () => {
        setMode(baseChatMode);
        goTo(0);
      },
      icon: Store,
    },
    {
      key: 'desktop',
      label: 'Desktop',
      active: activeIndex === 1,
      onClick: () => {
        setMode(baseChatMode);
        goTo(1);
      },
      icon: Monitor,
    },
    {
      key: 'media',
      label: 'Media',
      active: mode === 'media',
      onClick: () => setMode('media'),
      icon: ImageIcon,
    },
  ] as const;
  const historyView = (
    <div className="flex h-full min-h-0 flex-col px-4 py-3 text-white">
      <div className="mb-3 flex items-center justify-between text-sm text-white/70">
        <span className="text-base font-semibold text-white">Chats</span>
        {(friendsState.friendsLoading || groupState.groupsLoading) && (
          <span className="text-[11px] text-white/50">Syncing…</span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col gap-3 p-3">
          <button
            type="button"
            onClick={handleSelectAgent}
            className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors ${chatSurface === 'agent' ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'}`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/40 text-white">
              <MessageCircle className="h-4 w-4" />
            </span>
            <span className="font-medium">Start new chat</span>
          </button>
          <div className="flex-1 min-h-0 overflow-y-auto modern-scrollbar space-y-2 pr-1">
            {chatItems.length === 0 && !friendsState.friendsLoading && !groupState.groupsLoading ? (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-xs text-white/60">
                Your chats will show up here. Use the quick actions below to start one.
              </div>
            ) : (
              chatItems.map((item, index) => {
                const isActive = chatSurface === 'friend' && item.key === activeChatKey;
                return (
                  <button
                    key={`${item.key}-${index}`}
                    type="button"
                    onClick={() => handleSelectChatItem(item)}
                    className={`flex flex-col rounded-lg px-3 py-2 text-left text-xs transition-colors ${isActive ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'}`}
                  >
                    <span className="font-medium">{item.label}</span>
                    {item.description && <span className="text-[10px] text-white/50">{item.description}</span>}
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-white/10 pt-3">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleOpenFriendsPanel}
                className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 transition-colors hover:bg-white/10"
              >
                <UserPlus className="h-4 w-4" />
                <span>Add friend</span>
              </button>
              <button
                type="button"
                onClick={handleStartGroup}
                className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 transition-colors hover:bg-white/10"
              >
                <Users className="h-4 w-4" />
                <span>New group chat</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const agentConversation = (
      <div className="relative flex h-full min-h-0 flex-col px-4 py-3 text-white">
      <div className="mb-3 flex items-center gap-2 text-sm text-white/70">
        <button
          type="button"
          onClick={handleBackToHistory}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 hover:bg-white/10"
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-base font-semibold text-white">Assistant</span>
      </div>
      {agentStatus === 'ready' && undoDepth > 1 && (
        <button
          onClick={handleUndo}
          className="absolute right-4 top-3 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white/70 transition-colors hover:text-white"
          title="Undo changes"
        >
          <Undo2 className="h-3.5 w-3.5" />
          <span>Undo</span>
        </button>
      )}
      <div className="flex-1 min-h-0 overflow-hidden p-3">
        <div className="flex h-full min-h-0 flex-col gap-3">
          <ChatTabs
            openThreads={openThreads}
            historyThreads={historyThreads}
            threadsLoading={threadsLoading}
            threadsError={threadsError}
            activeThreadId={activeThreadId}
            setActiveThreadId={setActiveThreadId}
            showHistory={showThreadHistory}
            setShowHistory={(next) => {
              if (typeof next === 'function') {
                setShowThreadHistory((prev) => (next as (prev: boolean) => boolean)(prev));
                return;
              }
              setShowThreadHistory(next);
            }}
            onRefresh={() => { void refreshThreads(); }}
            onNewConversation={() => {
              activeThreadIdImmediateRef.current = null;
              startBlankThread();
            }}
            onClose={(id) => {
              if (activeThreadIdImmediateRef.current === id) {
                activeThreadIdImmediateRef.current = null;
              }
              closeThread(id);
            }}
            onOpenFromHistory={(id) => {
              activeThreadIdImmediateRef.current = id;
              setActiveThreadId(id);
            }}
          />
          <div className="flex-1 min-h-0">
            <MessagesPane
              messages={agentMessages}
              optimisticMessages={agentOptimisticMessages}
              status={agentStatus}
              messagesContainerRef={messagesContainerRef}
              messagesInnerRef={messagesInnerRef}
              containerHeight={containerHeight}
              didAnimateWelcome={didAnimateWelcome}
              bubbleAnimatingIds={bubbleAnimatingIds}
              lastSentAttachments={lastSentAttachments || undefined}
              activeThreadId={activeThreadId || undefined}
              agentActive={agentActive}
              onSuggestionSelect={(text) => {
                setInput(text);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const friendHeaderLabel = (() => {
    if (socialView.kind === 'dm') return activePeerLabel ?? 'Direct messages';
    if (socialView.kind === 'group') return activeGroupSummary?.name ?? 'Group chat';
    if (socialView.kind === 'auto') return groupState.autoRoom?.chat?.name ?? 'Auto room';
    return 'Friends';
  })();

  const friendBody = (() => {
    if (socialView.kind === 'settings') {
      return (
        <div className="modern-scrollbar h-full overflow-auto pr-1 space-y-4">
          <div className="flex flex-col gap-2">
            <div className="text-xs text-white/70">Profile</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 rounded-md border border-white/10 bg-white/90 px-2 py-1 text-xs text-black"
                placeholder="Nickname"
                defaultValue={friendsState.me?.nickname || ''}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== (friendsState.me?.nickname || '')) void friendsState.setNickname(v);
                }}
                disabled={!friendsState.isAuthenticated}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs text-white/70">Add friend</div>
            <AddFriendForm onAdd={(nickname) => friendsState.addFriend(nickname)} disabled={!friendsState.isAuthenticated} />
          </div>

          <div className="flex flex-col gap-2 text-xs text-white/70">
            <div className="flex items-center justify-between">
              <span>Groups</span>
              <button
                className="rounded-lg border border-white/15 px-2 py-1 text-white/80 transition-colors hover:bg-white/10"
                onClick={() => {
                  setShowCreateGroupForm((prev) => {
                    const next = !prev;
                    if (!next) resetGroupForm();
                    return next;
                  });
                }}
                disabled={groupFormBusy}
              >
                {showCreateGroupForm ? 'Cancel' : 'New group'}
              </button>
            </div>

            {showCreateGroupForm && (
              <form onSubmit={handleCreateGroup} className="flex flex-col gap-2 rounded-lg border border-white/15 bg-white/5 p-2">
                <input
                  type="text"
                  className="rounded border border-white/10 px-2 py-1 text-xs text-black"
                  placeholder="Group name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  disabled={groupFormBusy}
                />
                <div className="modern-scrollbar max-h-28 space-y-1 overflow-auto">
                  {friendsState.friends.map((friend) => {
                    const label = friend.nickname || friend.email || friend.ownerId.slice(0, 8);
                    const checked = newGroupMemberIds.includes(friend.ownerId);
                    return (
                      <label key={friend.ownerId} className="flex items-center gap-2 text-white/80">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleNewGroupMember(friend.ownerId)}
                          disabled={groupFormBusy}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                  {friendsState.friends.length === 0 && (
                    <div className="text-white/60">Add friends to invite them to a group.</div>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border border-white/20 px-2 py-1 text-white/70 hover:bg-white/10"
                    onClick={() => {
                      resetGroupForm();
                      setShowCreateGroupForm(false);
                    }}
                    disabled={groupFormBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded border border-sky-300/60 bg-sky-500/40 px-2 py-1 text-white transition-colors hover:bg-sky-500/60 disabled:opacity-50"
                    disabled={groupFormBusy || !newGroupName.trim()}
                  >
                    Create
                  </button>
                </div>
              </form>
            )}
            {groupState.groups.length > 0 && (
              <div className="flex flex-wrap gap-2 text-white/70">
                {groupState.groups.map((group) => (
                  <button
                    key={group.id}
                    className="rounded border border-white/15 px-2 py-1 hover:bg-white/10"
                    onClick={() => openGroupChat(group.id)}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            )}
            {groupState.groups.length === 0 && !showCreateGroupForm && (
              <div className="text-white/60">You have no groups yet.</div>
            )}
          </div>

          <div className="flex flex-col gap-2 text-xs text-white/70">
            <span>Auto group</span>
            {groupState.autoRoom?.chat ? (
              <div className="flex items-center justify-between">
                <span className="text-white/90">{groupState.autoRoom.chat.name}</span>
                <button
                  className="rounded border border-white/15 px-2 py-1 text-white/80 hover:bg-white/10"
                  onClick={() => void handleLeaveAutoRoom()}
                  disabled={groupFormBusy}
                >
                  Leave
                </button>
              </div>
            ) : (
              <button
                className="self-start rounded border border-white/15 px-2 py-1 text-white/80 hover:bg-white/10"
                onClick={() => void handleJoinAutoRoom()}
                disabled={!friendsState.isAuthenticated || groupFormBusy}
              >
                Join auto room
              </button>
            )}
          </div>
        </div>
      );
    }

    if (socialView.kind === 'dm') {
      return (
        <FriendMessagesPane
          messages={friendsState.dmMessages || []}
          activePeerId={socialView.peerId}
          currentUserId={myUserId ?? undefined}
          meLabel={meDisplayName}
          peerLabel={activePeerLabel || 'Friend'}
        />
      );
    }

    if (socialView.kind === 'group') {
      return (
        <GroupMessagesPane
          active={Boolean(activeGroupSummary)}
          emptyLabel="Select a group to view messages."
          messages={groupState.groupMessages}
          members={groupState.groupMembers}
          currentUserId={myUserId ?? undefined}
        />
      );
    }

    if (socialView.kind === 'auto') {
      return (
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-white/70">
            <span>{groupState.autoRoom?.chat ? groupState.autoRoom.chat.name : 'Auto group lobby'}</span>
            {groupState.autoRoom?.chat && (
              <span className="text-[10px] text-white/50">{autoRoomMembers.length} people</span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <GroupMessagesPane
              active={Boolean(groupState.autoRoom?.chat)}
              emptyLabel="Join the auto room to start chatting."
              messages={autoRoomMessages}
              members={autoRoomMembers}
              currentUserId={myUserId ?? undefined}
            />
          </div>
          {!groupState.autoRoom?.chat && (
            <button
              className="self-start rounded border border-sky-300/60 px-2 py-1 text-white hover:bg-sky-500/40 disabled:opacity-60"
              onClick={() => void handleJoinAutoRoom()}
              disabled={!friendsState.isAuthenticated || !groupState.isAuthenticated}
            >
              Join auto room
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="h-full text-sm text-white/60">Select a conversation to get started.</div>
    );
  })();

  const friendConversation = (
      <div className="flex h-full min-h-0 flex-col px-4 py-3 text-white">
      <div className="mb-3 flex items-center gap-2 text-sm text-white/70">
        <button
          type="button"
          onClick={handleBackToHistory}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 hover:bg-white/10"
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-base font-semibold text-white">{friendHeaderLabel}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden p-3">
        {friendBody}
      </div>
    </div>
  );

  const chatPane = chatSurface === 'history'
    ? historyView
    : chatSurface === 'agent'
      ? agentConversation
      : friendConversation;

  const bottomBar = (
    <div className="px-4 py-0 bg-white/5 border-t border-white/10">
      <div className="px-4 py-3">
      {chatSurface === 'agent' && (
        <ChatComposer
          input={input}
          setInput={setInput}
          status={agentStatus}
          attachments={attachments}
          removeAttachment={removeAttachment}
          onSubmit={handleAgentSubmit}
          onFileSelect={handleUploadFiles}
          onStop={() => stopAgent()}
          onFocus={() => setMode('chat')}
          uploadBusy={busyFlags.uploadBusy}
        />
      )}
      {chatSurface === 'friend' && socialView.kind !== 'settings' && (
        <ChatComposer
          input={input}
          setInput={setInput}
          status={socialComposerStatus}
          attachments={[]}
          removeAttachment={() => {}}
          onSubmit={handleSocialSubmit}
          onFileSelect={() => {}}
          onStop={() => {}}
          onFocus={() => setMode('friends')}
          uploadBusy={false}
        />
      )}
      {chatSurface === 'friend' && socialView.kind === 'settings' && (
        <div className="px-4 py-3 text-sm text-white/60 flex items-center h-[100px]">
          Select a chat to start messaging.
        </div>
      )}
      {chatSurface === 'history' && (
        <div className="px-4 py-3 text-sm text-white/60 flex items-center h-[100px]">
          Choose a conversation to begin.
        </div>
      )}
      </div>
    </div>
  );

  const navBar = (
    <div className="px-4 bg-white/5 border-b border-white/10">
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2 px-2 py-2">
        <div className="flex items-center gap-2">
          {navItems.map(({ key, label, active, onClick, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={onClick}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${active ? 'bg-white/25 text-white' : 'text-white/70 hover:bg-white/10'}`}
              aria-pressed={active}
              aria-label={label}
            >
              <Icon className="h-4 w-4" />
              <span className="sr-only">{label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center">
          <Authenticated>
            <UserButton />
          </Authenticated>
          <Unauthenticated>
            <SignInButton mode="modal">
              <button className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/20 bg-sky-500/40 text-white hover:bg-sky-500/60 transition-colors text-xs font-medium" aria-label="Sign In">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>Sign In</span>
              </button>
            </SignInButton>
          </Unauthenticated>
        </div>
      </div>
    </div>
  );

  const visitPane = (
    <div className="modern-scrollbar h-full overflow-auto px-4 py-3 text-white">
      <div className="mb-3 text-sm font-medium uppercase tracking-wide text-white/60">Visit Desktops</div>
      {desktopsLoading && <div className="text-sm text-white/70">Loading…</div>}
      {desktopsError && <div className="text-sm text-red-300">{desktopsError}</div>}
      {!desktopsLoading && !desktopsError && (
        <div className="grid grid-cols-1 gap-3">
          {desktopsListing.map((d) => (
            <div key={d._id} className="rounded-lg border border-white/15 bg-white/10 p-3 text-sm">
              <div className="flex items-center gap-2 text-white">
                <div>{d.icon || '🖥️'}</div>
                <div className="font-medium" title={d.title}>{d.title}</div>
              </div>
              {d.description && <div className="mt-2 text-xs text-white/70">{d.description}</div>}
              <div className="mt-3 flex items-center gap-2 text-xs">
                <a href={`/d/${d._id}`} className="rounded border border-white/30 px-2 py-1 text-white hover:bg-white/10">Open</a>
                <a href={`/api/visit/desktops/${d._id}/snapshot`} target="_blank" className="rounded border border-white/30 px-2 py-1 text-white hover:bg-white/10">Download</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const mediaPane = (
    <div className="h-full overflow-hidden px-4 py-3">
      <MediaPane
        mediaType={mediaType}
        setMediaType={setMediaType}
        loadMedia={loadMedia}
        loading={busyFlags.loading}
        error={mediaError}
        uploadError={uploadError}
        onFiles={handleUploadFiles}
        ingestUrl={ingestUrl}
        setIngestUrl={setIngestUrl}
        onIngest={handleIngestFromUrl}
        items={mediaItems}
        disabled={busyFlags.uploadBusy}
        formatBytes={formatBytes}
      />
    </div>
  );

  const mainContent = mode === 'media'
    ? mediaPane
    : mode === 'visit'
      ? visitPane
      : chatPane;

  return (
    <AgentBarShell
      isOpen={isOpen}
      isOpening={isOpening}
      isClosing={isClosing}
      onBackdropClick={() => setMode('compact')}
      barAreaRef={barAreaRef}
      dragOverlay={dragOverlay}
      bottomBar={bottomBar}
      navBar={navBar}
    >
      <div className="flex h-full min-h-0 flex-col text-white bg-white/5">
        <div className="flex-1 min-h-0 overflow-hidden">
          {mainContent}
        </div>
      </div>
      <style jsx global>{`
        .modern-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(56,189,248,0.45) transparent; }
        .modern-scrollbar::-webkit-scrollbar { width: 9px; height: 9px; }
        .modern-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .modern-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(56,189,248,0.45); border-radius: 9999px; border: 2px solid transparent; background-clip: content-box; }
        .modern-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(56,189,248,0.65); }
      `}</style>
    </AgentBarShell>
  );
}
