# Agent Tool Optimization Plan

## Context & Key Findings

### Current Performance Issues

#### 1. Sequential Tool Execution
- **Location**: `src/components/agent/AIAgentBar/hooks/useAgentChat.ts:141`
- **Issue**: Tool calls execute inline in a single async switch
- **Impact**: Long-running operations like `web_exec` block other safe tools (`web_fs_read`, `media_list`) that could run in parallel

#### 2. Package Install Race Conditions
- **Location**: `src/components/agent/AIAgentBar/hooks/useAgentChat.ts:300`
- **Issue**: `web_exec` branch runs package installs without mutual exclusion
- **Impact**: Overlapping installs can corrupt `node_modules` state

#### 3. Inefficient File Discovery
- **Location**: `src/components/agent/AIAgentBar/hooks/useAgentChat.ts:191`
- **Issue**: Loads entire recursive listing before filtering
- **Impact**: Broad `web_fs_find` requests traverse all entries before applying glob/limit filters

#### 4. Oversized File Responses
- **Location**: `src/components/agent/AIAgentBar/hooks/useAgentChat.ts:222`
- **Issue**: `web_fs_read` always returns full file contents
- **Impact**: Ignores optional `responseFormat` hints from `src/lib/agentTools.ts:6`

#### 5. Late Token Trimming
- **Location**: `src/lib/agent/server/agentServerHelpers.ts:48`
- **Issue**: Tool results capped at ~800 chars on server, but token-heavy inputs reach model first
- **Impact**: Unnecessary token consumption before trimming

---

## Implementation Plan

### Step 1: Implement Tool Scheduler
**Target File**: `src/components/agent/AIAgentBar/hooks/useAgentChat.ts`

**Objective**: Add concurrency layer for parallel tool execution

**Implementation**:
- Create lightweight scheduler that categorizes tools as "safe" vs "destructive"
- Run safe tools (`web_fs_read`, `media_list`) in parallel
- Funnel destructive tools (`web_exec`) through shared mutex
- Maintain execution order for dependent operations

### Step 2: Optimize File System Traversal
**Target Files**: 
- `src/components/agent/AIAgentBar/hooks/useAgentChat.ts`
- Shared WebContainer helpers

**Objective**: Apply filters during directory walking, not after

**Implementation**:
- Apply `limit`, `prefix`, and `glob` filters during traversal
- Enforce depth and entry count caps
- Add per-run caching for repeated root directories
- Short-circuit traversal when limits reached

### Step 3: Implement Smart File Reading
**Target Files**:
- `src/components/agent/AIAgentBar/hooks/useAgentChat.ts`
- `src/lib/agentTools.ts`

**Objective**: Return appropriately-sized file content based on context

**Implementation**:
- Support optional range/slice parameters
- Respect `responseFormat` hints from tool definitions
- Return concise snippets with minimal context by default
- Provide detailed content only when explicitly requested

### Step 4: Preserve Response Format Hints
**Target Files**:
- `src/components/agent/AIAgentBar/hooks/useAgentChat.ts`
- `src/lib/agent/server/agentServerHelpers.ts`

**Objective**: Maintain format preferences throughout tool pipeline

**Implementation**:
- Ensure `sanitizeToolInput` preserves `responseFormat` metadata
- Update client tool handlers to respect format hints
- Adjust outputs before calling `addToolResult`
- Maintain consistency between client and server formatting
