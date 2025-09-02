import { files } from '../data/webcontainer-files';

/**
 * Get the file system tree
 * This provides a cached reference to avoid re-creating the files object
 */
export function getFiles() {
  return files;
}
