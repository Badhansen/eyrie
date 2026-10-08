import { search } from '@/lib/algolia';
import { prisma } from '@/lib/prisma';

/**
 * Book catalog browsing: full-text search, with the database as the source of truth.
 */
export class CatalogService {
  async find(query: string): Promise<string[]> {
    const { hits } = await search.searchSingleIndex({ indexName: 'books', searchParams: { query } });
    return hits.map((hit) => hit.objectID);
  }

  async browse() {
    return prisma.book.findMany({ orderBy: { title: 'asc' } });
  }
}

export const catalogService = new CatalogService();
