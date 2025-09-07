import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";

export const r2 = new R2(components.r2);

export const {
  generateUploadUrl,
  syncMetadata,
  onSyncMetadata,
} = r2.clientApi({
  // Keep signed URL TTL modest by default; callers can override when generating URLs
});

export default r2;


