'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, Undo2 } from 'lucide-react';
import { useWebContainer } from './WebContainerProvider';
import { useScreens } from './ScreensProvider';
import { formatBytes } from '@/lib/agent/agentUtils';
import { useScrollSizing } from '@/components/agent/AIAgentBar/hooks/useScrollSizing';
import { useSocialPanelState } from '@/components/agent/AIAgentBar/hooks/useSocialPanelState';
import { useDesktopUndo } from '@/components/agent/AIAgentBar/hooks/useDesktopUndo';
import { useAgentController } from '@/components/agent/AIAgentBar/hooks/useAgentController';
import { useMediaController } from '@/components/agent/AIAgentBar/hooks/useMediaController';
import AgentBarShell from '@/components/agent/AIAgentBar/ui/AgentBarShell';
import Toolbar from '@/components/agent/AIAgentBar/ui/Toolbar';
import ChatTabs from '@/components/agent/AIAgentBar/ui/ChatTabs';
import MessagesPane from '@/components/agent/AIAgentBar/ui/MessagesPane';
import ChatComposer from '@/components/agent/AIAgentBar/ui/ChatComposer';
import MediaPane from '@/components/agent/AIAgentBar/ui/MediaPane';
import AddFriendForm from '@/components/agent/AIAgentBar/ui/AddFriendForm';
import FriendMessagesPane from '@/components/agent/AIAgentBar/ui/FriendMessagesPane';
import GroupMessagesPane from '@/components/agent/AIAgentBar/ui/GroupMessagesPane';
import { buildDesktopSnapshot, restoreDesktopSnapshot } from '@/utils/desktop-snapshot';
import { getMutableWindow } from '@/components/agent/AIAgentBar/utils/window';
import type { Doc } from '../../convex/_generated/dataModel';

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'compact' | 'chat' | 'visit' | 'media' | 'friends'>('chat');
  const [leftPane, setLeftPane] = useState<'agent' | 'friend'>('agent');
  
  const { goTo, activeIndex } = useScreens();
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn, waitForDepsReady } = useWebContainer();
  
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
    setLeftPane('friend');
    setMode('friends');
  }, [setLeftPane, setMode]);

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
  const baseFnsRef = useRef({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn, waitForDepsReady });
  const fnsRef = useRef({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn, waitForDepsReady });
  useEffect(() => { instanceRef.current = instance; }, [instance]);
  useEffect(() => { baseFnsRef.current = { mkdir, writeFile, readFile, readdirRecursive, remove, spawn, waitForDepsReady }; }, [mkdir, writeFile, readFile, readdirRecursive, remove, spawn, waitForDepsReady]);

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
      waitForDepsReady: base.waitForDepsReady,
    } as typeof fnsRef.current;
    fnsRef.current = tracked;
  }, [markFsChanged, mkdir, writeFile, readFile, readdirRecursive, remove, spawn, waitForDepsReady]);


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
  // Bottom bar
  const bottomBar = (
    <div className="rounded-none px-4 py-3 bg-transparent">
      <div className="flex items-center gap-2">
        <Toolbar
          activeIndex={activeIndex}
          onToggleHomeStore={() => goTo(activeIndex === 0 ? 1 : 0)}
          onVisit={() => setMode('visit')}
          onMedia={() => setMode('media')}
          onFriends={() => openFriendsSettings()}
        />
        {/* Left Undo removed */}
        <div className="flex-1 relative">
          <Search className="absolute left-16 top-1/2 -translate-y-1/2 h-4 w-4 text-white" />
          {leftPane === 'agent' && (
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
          {leftPane === 'friend' && socialView.kind !== 'settings' && (
            <ChatComposer
              input={input}
              setInput={setInput}
              status={socialComposerStatus}
              attachments={[]}
              removeAttachment={() => {}}
              onSubmit={handleSocialSubmit}
              onFileSelect={()=>{}}
              onStop={()=>{}}
              onFocus={() => setMode('friends')}
              uploadBusy={false}
            />
          )}
        </div>
      </div>
    </div>
  );



  return (
    <AgentBarShell
      isOpen={isOpen}
      isOpening={isOpening}
      isClosing={isClosing}
      onBackdropClick={() => setMode('compact')}
      barAreaRef={barAreaRef}
      dragOverlay={dragOverlay}
      bottomBar={bottomBar}
    >
      <div className="bg-transparent text-white">
        {(mode === 'chat' || mode === 'friends') && (
          <div className="relative pb-3">
            <div className="border border-white/15 bg-white/5 overflow-hidden">
              <div className="grid grid-cols-[220px_minmax(0,1fr)]">
                {/* Left switcher: Agent vs Friends */}
                <div className="min-h-[420px] border-r border-white/15">
                  <div className="px-3 pt-3 pb-3 flex flex-col gap-2">
                    <div className="text-xs text-white/70 mb-1">Chats</div>
                    <div className="flex flex-col gap-1">
                      <button
                        className={`text-left text-sm px-2 py-1 rounded ${leftPane==='agent' ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10'}`}
                        onClick={()=>{ setLeftPane('agent'); setMode('chat'); }}
                      >
                        Agent
                      </button>
                      <button
                        className={`text-left text-sm px-2 py-1 rounded ${leftPane==='friend' ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10'}`}
                        onClick={() => { openFriendsSettings(); }}
                      >
                        Friends
                      </button>
                    </div>

                    {leftPane==='friend' && (
                      <div className="mt-2 flex flex-col gap-2">
                        {friendsState.friendsLoading && (<div className="text-xs text-white/60">Loading friends…</div>)}
                        {friendsState.friendsError && (<div className="text-xs text-red-300">{friendsState.friendsError}</div>)}
                        {groupState.groupsLoading && (<div className="text-xs text-white/60">Loading groups…</div>)}
                        <div className="flex flex-col gap-1 max-h-[260px] overflow-auto">
                          {chatItems.map((item) => {
                            const isActive = item.key === activeChatKey;
                            const buttonClasses = isActive ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10';
                            return (
                              <button
                                key={item.key}
                                className={`text-left text-xs px-2 py-1 rounded ${buttonClasses}`}
                                onClick={() => {
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
                                }}
                              >
                                <div className="flex flex-col gap-0.5">
                                  <span>{item.label}</span>
                                  {item.description && (
                                    <span className="text-[10px] text-white/50">{item.description}</span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                          {chatItems.length === 0 && !friendsState.friendsLoading && !groupState.groupsLoading && (
                            <div className="text-xs text-white/60">No chats yet. Use the Friends panel to start one.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="min-h-[420px] flex flex-col">
                  <div className="flex flex-col gap-3 h-full px-3 pt-3 pb-3">
                    {leftPane==='agent' && (
                      <>
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
                      </>
                    )}
                    {leftPane==='friend' && (
                      <div className="flex flex-col gap-3 flex-1 min-h-0">
                        {socialView.kind === 'settings' && (
                          <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-auto pr-1">
                            <div className="flex flex-col gap-2">
                              <div className="text-xs text-white/70">Profile</div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  className="rounded-none text-black px-2 py-1 text-xs flex-1"
                                  placeholder="Nickname"
                                  defaultValue={friendsState.me?.nickname || ''}
                                  onBlur={(e)=>{ const v = e.target.value.trim(); if (v && v !== (friendsState.me?.nickname||'')) void friendsState.setNickname(v); }}
                                  disabled={!friendsState.isAuthenticated}
                                />
                              </div>
                            </div>

                            <div className="flex flex-col gap-2">
                              <div className="text-xs text-white/70 mb-1">Add friend</div>
                              <AddFriendForm onAdd={(nickname)=> friendsState.addFriend(nickname)} disabled={!friendsState.isAuthenticated} />
                            </div>

                            <div className="flex flex-col gap-2 text-xs text-white/70">
                              <div className="flex items-center justify-between">
                                <span>Groups</span>
                                <button
                                  className="px-2 py-1 rounded border border-white/20 text-white/80 hover:bg-white/10"
                                  onClick={() => {
                                    setShowCreateGroupForm((prev) => {
                                      const next = !prev;
                                      if (!next) resetGroupForm();
                                      return next;
                                    });
                                  }}
                                >
                                  {showCreateGroupForm ? 'Close' : 'Create group'}
                                </button>
                              </div>
                              {showCreateGroupForm && (
                                <form onSubmit={handleCreateGroup} className="flex flex-col gap-2 border border-white/15 bg-white/5 p-2 rounded">
                                  <input
                                    type="text"
                                    className="rounded-none text-black px-2 py-1 text-xs"
                                    placeholder="Group name"
                                    value={newGroupName}
                                    onChange={(e)=> setNewGroupName(e.target.value)}
                                    disabled={groupFormBusy}
                                  />
                                  <div className="flex flex-col gap-1 max-h-28 overflow-auto">
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
                                      className="px-2 py-1 border border-white/20 rounded text-white/70 hover:bg-white/10"
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
                                      className="px-2 py-1 border border-sky-300/60 rounded text-white bg-sky-500/40 hover:bg-sky-500/60 disabled:opacity-50"
                                      disabled={groupFormBusy || !newGroupName.trim()}
                                    >
                                      Create
                                    </button>
                                  </div>
                                </form>
                              )}
                              {groupState.groups.length > 0 && (
                                <div className="flex flex-wrap gap-2 text-white/60">
                                  {groupState.groups.map((group) => (
                                    <button
                                      key={group.id}
                                      className="px-2 py-1 rounded border border-white/20 text-white/80 hover:bg-white/10"
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
                                <div className="flex flex-col gap-2 text-white/80">
                                  <div>{groupState.autoRoom.chat.name} · {autoRoomMembers.length} people</div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      className="px-2 py-1 rounded border border-white/20 hover:bg-white/10"
                                      onClick={() => openAutoChat()}
                                    >
                                      Open chat
                                    </button>
                                    <button
                                      className="px-2 py-1 rounded border border-red-400/60 text-red-200 hover:bg-red-500/20"
                                      onClick={() => void handleLeaveAutoRoom()}
                                    >
                                      Leave
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-2 text-white/80">
                                  <div>Join a pre-made room with up to 20 creators.</div>
                                  <button
                                    className="px-2 py-1 rounded border border-sky-300/60 text-white hover:bg-sky-500/40 disabled:opacity-60"
                                    onClick={() => void handleJoinAutoRoom()}
                                    disabled={!friendsState.isAuthenticated || !groupState.isAuthenticated}
                                  >
                                    Join auto room
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {socialView.kind === 'dm' && (
                          <div className="flex flex-col gap-2 flex-1 min-h-0">
                            <div className="text-xs text-white/70 flex items-center justify-between">
                              <span>{activePeerLabel ?? 'Direct message'}</span>
                            </div>
                            <div className="flex-1 min-h-0">
                              <FriendMessagesPane
                                messages={friendsState.dmMessages || []}
                                activePeerId={socialView.peerId}
                                currentUserId={myUserId ?? undefined}
                                meLabel={meDisplayName}
                                peerLabel={activePeerLabel || 'Friend'}
                              />
                            </div>
                          </div>
                        )}

                        {socialView.kind === 'group' && (
                          <div className="flex flex-col gap-2 flex-1 min-h-0">
                            <div className="flex items-center justify-between text-xs text-white/70">
                              <span>{activeGroupSummary ? activeGroupSummary.name : 'Select a group to start chatting.'}</span>
                              {activeGroupSummary && (
                                <button
                                  className="px-2 py-1 rounded border border-red-400/60 text-red-200 hover:bg-red-500/20"
                                  onClick={() => {
                                    void groupState.leaveGroup(activeGroupSummary.id).then(() => {
                                      openFriendsSettings();
                                    });
                                  }}
                                >
                                  Leave group
                                </button>
                              )}
                            </div>
                            <div className="flex-1 min-h-0">
                              <GroupMessagesPane
                                active={Boolean(activeGroupSummary)}
                                emptyLabel="Select a group to view messages."
                                messages={groupState.groupMessages}
                                members={groupState.groupMembers}
                                currentUserId={myUserId ?? undefined}
                              />
                            </div>
                          </div>
                        )}

                        {socialView.kind === 'auto' && (
                          <div className="flex flex-col gap-2 flex-1 min-h-0">
                            <div className="text-xs text-white/70 flex items-center justify-between">
                              <span>{groupState.autoRoom?.chat ? groupState.autoRoom.chat.name : 'Auto group lobby'}</span>
                              {groupState.autoRoom?.chat && (
                                <span className="text-white/50 text-[10px]">{autoRoomMembers.length} people</span>
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
                                className="self-start px-2 py-1 rounded border border-sky-300/60 text-white hover:bg-sky-500/40 disabled:opacity-60"
                                onClick={() => void handleJoinAutoRoom()}
                                disabled={!friendsState.isAuthenticated || !groupState.isAuthenticated}
                              >
                                Join auto room
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {agentStatus === 'ready' && undoDepth > 1 && (
              <button
                onClick={handleUndo}
                className="absolute right-6 bottom-2 z-40 p-3 text-white/70 hover:text-white transition-colors flex items-center gap-2"
                title="Undo changes"
              >
                <Undo2 className="h-4 w-4" />
                <span className="text-sm">undo</span>
              </button>
            )}

            <style jsx>{`
              .ios-pop { animation: iosPop 420ms cubic-bezier(0.22, 1, 0.36, 1) both; transform-origin: bottom left; }
              @keyframes iosPop {
                0% { transform: scale(0.92); opacity: 0; }
                60% { transform: scale(1.02); opacity: 1; }
                100% { transform: scale(1); opacity: 1; }
              }
              @media (prefers-reduced-motion: reduce) {
                .ios-pop { animation-duration: 1ms; }
              }
            `}</style>
            <style jsx global>{`
              .modern-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(56,189,248,0.45) transparent; }
              .modern-scrollbar::-webkit-scrollbar { width: 9px; height: 9px; }
              .modern-scrollbar::-webkit-scrollbar-track { background: transparent; }
              .modern-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(56,189,248,0.45); border-radius: 9999px; border: 2px solid transparent; background-clip: content-box; }
              .modern-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(56,189,248,0.65); }
            `}</style>
          </div>
        )}

        {mode === 'visit' && (
          <div className="px-4 py-3">
            <div className="font-medium mb-2">Visit Desktops</div>
            {desktopsLoading && <div className="text-sm text-gray-500">Loading…</div>}
            {desktopsError && <div className="text-sm text-red-600">{desktopsError}</div>}
            {!desktopsLoading && !desktopsError && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {desktopsListing.map((d) => (
                  <div key={d._id} className="border border-white/10 dark:border-white/10 p-2 bg-white text-black hover:bg-white/90 transition-colors">
                    <div className="flex items-center gap-2">
                      <div>{d.icon || '🖥️'}</div>
                      <div className="font-medium truncate" title={d.title}>{d.title}</div>
                    </div>
                    {d.description && <div className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">{d.description}</div>}
                    <div className="mt-2 flex items-center gap-2">
                      <a href={`/d/${d._id}`} className="text-xs px-2 py-1 bg-black text-white">Open</a>
                      <a href={`/api/visit/desktops/${d._id}/snapshot`} target="_blank" className="text-xs px-2 py-1 border">Download</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'media' && (
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
        )}
      </div>
    </AgentBarShell>
  );
}
