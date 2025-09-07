import { notFound } from 'next/navigation';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export default async function VisitPage({ params }: { params: { id: string } }) {
  const id = params.id;
  // Fetch desktop record
  let desktop: any | null = null;
  try {
    const data = await fetchJSON<{ desktops: any[] }>(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/visit/desktops?limit=1&search=&ownerId=&visibility=public&_=${Date.now()}`);
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


