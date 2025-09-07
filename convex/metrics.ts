import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

function fmtDay(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export const increment = internalMutation({
  args: {
    name: v.string(),
    by: v.optional(v.number()),
  },
  returns: v.id("metrics_daily"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const day = fmtDay(now);
    const name = args.name;
    const by = args.by ?? 1;
    const existing = await ctx.db
      .query('metrics_daily')
      .withIndex('by_day_name', (q) => q.eq('day', day).eq('name', name))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + by });
      return existing._id;
    }
    return await ctx.db.insert('metrics_daily', { day, name, count: by });
  },
});


