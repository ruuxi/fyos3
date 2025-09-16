import { notFound } from 'next/navigation';
import type { Doc } from '../../../../convex/_generated/dataModel';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

export default async function VisitPage({ params }: { params: { id: string } }) {
  const id = params.id;
  // Fetch desktop record
  type PublicDesktop = Doc<'desktops_public'>;
  let desktop: PublicDesktop | null = null;
  try {
    const data = await fetchJSON<{ desktops: PublicDesktop[] }>(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/visit/desktops?limit=1&search=&ownerId=&visibility=public&_=${Date.now()}`);
    desktop = (data.desktops || []).find((d) => String(d._id) === id) || null;
  } catch {}
  if (!desktop) {
    // Optimistically try snapshot directly when record listing not available
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/visit/desktops/${id}/snapshot`, { cache: 'no-store' });
      if (!res.ok) return notFound();
    } catch {
      return notFound();
    }
  }

  return (
    <div className="h-screen w-screen">
      <iframe
        title="Visited Desktop"
        src={`/app.html?visit=${encodeURIComponent(id)}`}
        className="w-full h-full border-0"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
      />
    </div>
  );
}

