export type ChatThread = {
  _id: string;
  title: string;
  updatedAt?: number;
  lastMessageAt?: number;
};

export type MediaItem = {
  _id: string;
  contentType: string;
  publicUrl?: string;
  r2Key: string;
  createdAt: number;
  size?: number;
};


